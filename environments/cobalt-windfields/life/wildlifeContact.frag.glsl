varying vec2 vContact;
varying float vOpacity;
void main(){
 float radius=length(vContact);
 float alpha=vOpacity*(1.0-smoothstep(0.28,1.0,radius));
 if(alpha<0.002)discard;
 gl_FragColor=vec4(vec3(0.065,0.055,0.065),alpha);
}
