uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uHaze;
uniform vec3 uSunGlow;
uniform vec3 uSkyUp;
uniform vec3 uSun;
uniform float uDome;
varying vec3 vRay;
varying vec2 vScreen;

float cloudNoise(float x) {
  float a=floor(x),t=fract(x);
  t=t*t*(3.0-2.0*t);
  return mix(fract(sin(a*127.1)*43758.5453),fract(sin((a+1.0)*127.1)*43758.5453),t);
}

// A clear blue dusk above thin apricot cloud ribbons, as in the environment painting.
void main() {
  vec3 dir = normalize(vRay);
  float elevation = dot(dir, uSkyUp);
  float y = vScreen.y * 0.5 + 0.5;
  vec3 backdrop = mix(uHorizon, uZenith, smoothstep(0.08,0.9,y));
  float rise = smoothstep(-0.035,0.18,elevation);
  vec3 dome = mix(uHorizon,uZenith,pow(rise,0.45));
  dome = mix(dome,uHaze,smoothstep(-0.07,-0.2,elevation));
  float heading = dot(dir,normalize(cross(uSkyUp,abs(uSkyUp.y)<0.9?vec3(0,1,0):vec3(1,0,0))));
  float cloud=0.0;
  for(int i=0;i<3;i++) {
    float h=heading*45.0+float(i)*67.0;
    float ragged=cloudNoise(h*1.7)*.002+cloudNoise(h*5.3)*.0008;
    float band=0.018+float(i)*0.031+0.004*sin(heading*11.0+float(i)*1.8)+ragged;
    float edge=abs(elevation-band);
    float width=.0012+.003*cloudNoise(h*.4);
    float stripe=1.0-smoothstep(width,width+.0006,edge);
    float broken=smoothstep(.27,.48,cloudNoise(h*.24)+cloudNoise(h*1.3)*.18);
    cloud=max(cloud,stripe*broken);
  }
  dome=mix(dome,uSunGlow*0.77,cloud*0.72);
  vec3 col=mix(backdrop,dome,uDome);
  float sun=max(dot(dir,uSun),0.0);
  col+=uSunGlow*pow(sun,30.0)*0.08;
  gl_FragColor=vec4(col,1.0);
}
