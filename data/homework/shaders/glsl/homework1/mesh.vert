#version 450

layout (location = 0) in vec3 inPos;
layout (location = 1) in vec3 inNormal;
layout (location = 2) in vec2 inUV;
layout (location = 3) in vec4 inTangent;
layout (location = 4) in vec4 inColor;

layout (set = 0, binding = 0) uniform UBOScene
{
	mat4 projection;
	mat4 model;
	mat4 view;
	vec3 camPos;
} uboScene;

layout (set = 2, binding = 0) uniform UBONode
{
	mat4 model;
} uboNode;

layout (location = 0) out vec3 outWorldPos;
layout (location = 1) out vec3 outNormal;
layout (location = 2) out vec2 outUV;
layout (location = 3) out vec4 outTangent;
layout (location = 4) out vec4 outColor;


void main() 
{
	mat4 model = uboScene.model * uboNode.model;
	vec4 locPos = model * vec4(inPos, 1.0);
	locPos.y = -locPos.y;

	outWorldPos = locPos.xyz / locPos.w;
	outNormal = normalize(transpose(inverse(mat3(model))) * inNormal);
	outTangent = vec4(mat3(model) * inTangent.xyz, inTangent.w);
	outColor = inColor;
	outUV = inUV;

	gl_Position = uboScene.projection * uboScene.view * vec4(outWorldPos, 1.0);
}