#version 450

layout (set = 1, binding = 0) uniform sampler2D albedoMap;
layout (set = 1, binding = 1) uniform sampler2D normalMap;
layout (set = 1, binding = 2) uniform sampler2D aoMap;
layout (set = 1, binding = 3) uniform sampler2D metallicRoughnessMap;

// Roughness is stored in the 'g' channel, metallic is stored in the 'b' channel.
// This layout intentionally reserves the 'r' channel for (optional) occlusion map data

layout (location = 0) in vec3 inWorldPos;
layout (location = 1) in vec3 inNormal;
layout (location = 2) in vec2 inUV;
layout (location = 3) in vec4 inTangent;
layout (location = 4) in vec4 inColor;

layout (set = 0, binding = 0) uniform UBO {
	mat4 projection;
	mat4 model;
	mat4 view;
	vec3 camPos;
} ubo;

layout (set = 0, binding = 1) uniform UBOParams {
	vec4 lights[4];
	float exposure;
	float gamma;
} uboParams;
layout (set = 0, binding = 2) uniform samplerCube samplerIrradiance;

layout (location = 0) out vec4 outFragColor;

const float PI = 3.14159265359;
//#define ROUGHNESS_PATTERN 1
#define ALBEDO pow(texture(albedoMap, inUV).rgb, vec3(2.2))

vec3 calculateNormal()
{
	vec3 tangentNormal = texture(normalMap, inUV).xyz * 2.0 - 1.0;

	vec3 N = normalize(inNormal);
	vec3 T = normalize(inTangent.xyz);
	vec3 B = normalize(cross(N, T));
	mat3 TBN = mat3(T, B, N);
	return normalize(TBN * tangentNormal);
}

// Normal Distribution function --------------------------------------
float D_GGX(float dotNH, float roughness)
{
	float alpha = roughness * roughness;
	float alpha2 = alpha * alpha;
	float denom = dotNH * dotNH * (alpha2 - 1.0) + 1.0;
	return (alpha2)/(PI * denom*denom); 
}

// Geometric Shadowing function --------------------------------------
float G_SchlicksmithGGX(float dotNL, float dotNV, float roughness)
{
	float r = (roughness + 1.0);
	float k = (r*r) / 8.0;
	float GL = dotNL / (dotNL * (1.0 - k) + k);
	float GV = dotNV / (dotNV * (1.0 - k) + k);
	return GL * GV;
}

// Fresnel function ----------------------------------------------------
vec3 F_Schlick(float cosTheta, float metallic)
{
    // calculate reflectance at normal incidence; if dia-electric (like plastic) use F0 
    // of 0.04 and if it's a metal, use the albedo color as F0 (metallic workflow)    
	vec3 F0 = mix(vec3(0.04), ALBEDO, metallic); // * material.specular
	vec3 F = F0 + (1.0 - F0) * pow(1.0 - cosTheta, 5.0); 
	return F;    
}

// Specular BRDF composition --------------------------------------------

vec3 BRDF(vec3 L, vec3 V, vec3 N, float metallic, float roughness, vec3 radiance)
{
	// Precalculate vectors and dot products	
	vec3 H = normalize (V + L);
	float dotNV = clamp(dot(N, V), 0.0, 1.0);
	float dotNL = clamp(dot(N, L), 0.0, 1.0);
	float dotLH = clamp(dot(L, H), 0.0, 1.0);
	float dotNH = clamp(dot(N, H), 0.0, 1.0);

	vec3 color = vec3(0.0);

	if (dotNL > 0.0)
	{
		float rroughness = max(0.05, roughness);
		// D = Normal distribution (Distribution of the microfacets)
		float D = D_GGX(dotNH, roughness); 
		// G = Geometric shadowing term (Microfacets shadowing)
		float G = G_SchlicksmithGGX(dotNL, dotNV, rroughness);
		// F = Fresnel factor (Reflectance depending on angle of incidence)
		vec3 F = F_Schlick(dotNV, metallic);
		vec3 numerator    = D * G * F; 
		float denominator = 4.0 * max(dot(N, V), 0.0) * max(dot(N, L), 0.0) + 0.0001; // + 0.0001 to prevent divide by zero
		vec3 specular = numerator / denominator;
		// kS is equal to Fresnel
        vec3 kS = F;
        // for energy conservation, the diffuse and specular light can't
        // be above 1.0 (unless the surface emits light); to preserve this
        // relationship the diffuse component (kD) should equal 1.0 - kS.
        vec3 kD = vec3(1.0) - kS;
        // multiply kD by the inverse metalness such that only non-metals 
        // have diffuse lighting, or a linear blend if partly metal (pure metals
        // have no diffuse light).
        kD *= 1.0 - metallic;	  
		vec3 spec = D * F * G / (4.0 * dotNL * dotNV);

		color += (kD * ALBEDO / PI + specular) * radiance * dotNL;
	}

	return color;
}

// ----------------------------------------------------------------------------
void main() 
{

	vec3 N = normalize(calculateNormal());
	vec3 V = normalize(ubo.camPos - inWorldPos);

	float roughness = texture(metallicRoughnessMap, inUV).g;
	float metallic = texture(metallicRoughnessMap, inUV).b;
	// Add striped pattern to roughness based on vertex position
#ifdef ROUGHNESS_PATTERN
	roughness = max(roughness, step(fract(inWorldPos.y * 2.02), 0.5));
#endif

	// Specular contribution
	vec3 Lo = vec3(0.0);
	for (int i = 0; i < uboParams.lights.length(); i++) {
		vec3 L = normalize(uboParams.lights[i].xyz - inWorldPos);
		float distance = length(uboParams.lights[i].xyz - inWorldPos);
        float attenuation = 1.0 / (distance * distance);
		vec3 lightColor = vec3(1.0);
        vec3 radiance = lightColor * attenuation;
		Lo += BRDF(L, V, N, metallic, roughness, radiance);
	};

	// Combine with ambient
	vec3 color = ALBEDO * 0.02;
	color += Lo;

	// HDR tonemapping
    color = color / (color + vec3(1.0));

	// Gamma correct
	color = pow(color, vec3(0.4545));

	outFragColor = vec4(color, 1.0);

//	outFragColor = vec4(ALBEDO, 1.0);	
//	outFragColor = vec4(calculateNormal(), 1.0);	
//	outFragColor = vec4(texture(metallicRoughnessMap, inUV).bbb, 1.0);	
//	outFragColor = vec4(inNormal, 1.0);		
}