// Pale butter sky with finite, wind-stretched ivory cloud shapes.
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uHaze;
uniform vec3 uSunGlow;
uniform vec3 uSkyUp;
uniform vec3 uSun;
uniform float uDome;
uniform float uSkyTime;
varying vec3 vRay;
varying vec2 vScreen;
vec3 skyGradient(float h) {
 return mix(uHorizon,uZenith,pow(clamp(h,0.0,1.0),0.62));
}
float wisp(vec2 p,vec2 start,vec2 end,float width,float bend,float phase){
 float t=(p.x-start.x)/(end.x-start.x);
 if(t<=0.0||t>=1.0)return 0.0;
 float shape=pow(sin(t*3.14159265),1.4);
 float centre=mix(start.y,end.y,t)+bend*sin(t*3.14159265)+0.006*shape*sin(t*19.0+phase);
 float shoulder=0.55+0.28*sin(t*7.0+phase)+0.17*sin(t*17.0+phase*2.0);
 float top=centre+width*shape*shoulder;
 float bottom=centre-width*shape*(0.35+0.22*sin(t*11.0+phase));
 float aa=max(fwidth(p.y)*0.8,0.0008);
 return smoothstep(bottom-aa,bottom+aa,p.y)*(1.0-smoothstep(top-aa,top+aa,p.y));
}
void main(){
 vec3 dir=normalize(vRay);
 float y=vScreen.y*0.5+0.5;
 vec3 backdrop=skyGradient(smoothstep(0.06,1.04,y));
 backdrop=mix(backdrop,uHaze,smoothstep(0.3,0.0,y)*0.3);
 float e=dot(dir,uSkyUp);
 vec3 dome=mix(skyGradient(e*1.35),uHaze,smoothstep(0.04,-0.15,e));
 vec3 col=mix(backdrop,dome,uDome);
 float sun=max(dot(dir,uSun),0.0);
 col+=uSunGlow*pow(sun,10.0)*0.018;
 vec3 east=normalize(cross(uSkyUp,abs(uSkyUp.y)<0.9?vec3(0.0,1.0,0.0):vec3(1.0,0.0,0.0)));
 vec3 north=normalize(cross(east,uSkyUp));
 float azimuth=atan(dot(dir,east),dot(dir,north));
 float skyX=mix(vScreen.x*0.65,azimuth,uDome)+uSkyTime*0.0008;
 float skyY=mix(vScreen.y,e*1.8-0.1,uDome);
 // Each angular interval holds a finite shape. A ground-level view sees
 // tapered ends and a broad uneven body, rather than a slice of a huge stripe.
 vec2 low=vec2(fract(skyX/0.9+0.27)-0.5,skyY);
 vec2 high=vec2(fract(skyX/1.15+0.66)-0.5,skyY);
 vec2 upper=vec2(fract(skyX/1.4+0.15)-0.5,skyY);
 float clouds=wisp(low,vec2(-0.41,0.09),vec2(0.40,0.47),0.105,-0.02,0.6);
 clouds=max(clouds,wisp(high,vec2(-0.37,0.60),vec2(0.27,1.05),0.13,0.03,2.5));
 clouds=max(clouds,wisp(upper,vec2(-0.36,1.12),vec2(0.35,1.19),0.08,0.025,4.1));
 col=mix(col,pow(vec3(0.97,0.955,0.89),vec3(2.2)),clouds*0.92);
 gl_FragColor=vec4(col,1.0);
}
