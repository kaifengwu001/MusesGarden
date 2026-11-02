/** Every family keeps the renderer's eight-sphere data layout and fits its
 * existing conservative sphere around (0, .45, 0), including 5% animation. */
export interface CloudPuff { x: number; y: number; z: number; r: number; phase: number; }

export function makeCloudPuffs(rand: () => number, family: number): CloudPuff[] {
  const habit=((family%5)+5)%5;
  const stretch=0.88+rand()*0.16, bend=(rand()-.5)*0.16;
  const puffs:CloudPuff[]=[];
  for(let i=0;i<8;i++){
    const t=i/7, jitter=(rand()-.5)*.055;
    let x:number,y:number,z:number,r:number;
    if(habit===0){
      // Unequal, broad billows with two raised shoulders instead of a row.
      const a=i*2.3999632297;
      const reach=i<5?.4:.19;
      x=Math.cos(a)*reach;
      z=Math.sin(a)*reach*.78;
      y=i<5?.20+.06*rand():.43+.12*rand();
      r=i<5?.29+.065*rand():.25+.08*rand();
    }else if(habit===1){
      // A bent wisp tapers to small detached trailing puffs.
      x=(t-.5)*2.05;
      z=.32*Math.sin(t*Math.PI*1.35)-.16;
      y=.16+.08*Math.sin(t*Math.PI);
      r=.13+.13*Math.sin((.12+t*.82)*Math.PI)+jitter;
    }else if(habit===2){
      // Two unequal banks, with a genuine gap rather than a thinner waist.
      const right=i>=5, k=right?i-5:i;
      const a=k*2.3999632297;
      x=(right?.65:-.48)+Math.cos(a)*(right?.11:.19);
      z=(right?.16:-.10)+Math.sin(a)*.16;
      y=.18+(k%2)*.12;
      r=(right?.15:.23)+.04*rand();
    }else if(habit===3){
      // A crescent bank, with a broad head and a thin curled tail.
      const a=-1.15+t*2.35;
      x=Math.sin(a)*.78;
      z=Math.cos(a)*.49-.27;
      y=.18+.12*(1-t);
      r=.18+.14*(1-t)+jitter;
    }else{
      // Compact fair-weather cloudlets; the detached satellites differ in size.
      const a=i*2.3999632297;
      const reach=i<4?.20:.48;
      x=Math.cos(a)*reach;
      z=Math.sin(a)*reach*.7;
      y=.15+.12*rand();
      r=(i<4?.21:.10)+.035*rand();
    }
    puffs.push({x:x*stretch,y,z:z+bend*x,r,phase:rand()*Math.PI*2});
  }
  return puffs;
}
