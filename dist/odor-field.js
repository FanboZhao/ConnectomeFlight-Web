import { loadImage } from './resource.js?v=loading-20261118';
/* Render a prepainted odor-field backdrop; no environment or sampling model. */
// The shared appearance texture was painted around the first displayed source.
const REFERENCE_SOURCE = [28, -4.5];
export class OdorFieldLayer {
  async load(signal) {
    if(this.image)return;
    const image=await loadImage('./media/odor-field.png?v=loading-20261118',signal);
    if(signal.aborted)throw signal.reason;
    const canvas=document.createElement('canvas');
    canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
    const ctx=canvas.getContext('2d'),{width,height}=canvas;
    ctx.drawImage(image,0,0);image.src='';
    ctx.globalCompositeOperation='destination-in';
    for(const [x,y,fade] of [[width,0,.08],[0,height,.24]]) {
      const mask=ctx.createLinearGradient(0,0,x,y);
      mask.addColorStop(0,'transparent');mask.addColorStop(fade,'#fff');
      mask.addColorStop(1-fade,'#fff');mask.addColorStop(1,'transparent');
      ctx.fillStyle=mask;ctx.fillRect(0,0,width,height);
    }
    this.image=canvas;
  }

  draw(ctx,{width,height,unproject,source,time=0}) {
    if(!this.image?.width)return;
    const o=unproject([0,0]),x=unproject([width,0]),y=unproject([0,height]);
    const a=(x[0]-o[0])/width,b=(x[1]-o[1])/width,c=(y[0]-o[0])/height,d=(y[1]-o[1])/height,det=a*d-b*c;
    const project=(p)=>[(d*(p[0]-o[0])-c*(p[1]-o[1]))/det,(-b*(p[0]-o[0])+a*(p[1]-o[1]))/det];
    // Translate the same presentation texture to this scene, then enlarge it
    // around its source. The original scene keeps exactly the same transform.
    const expand=([x,y])=>[source[0]+(x-REFERENCE_SOURCE[0])*1.2,source[1]+(y-REFERENCE_SOURCE[1])*1.2];
    const p=project(expand([-6,10])),q=project(expand([34,10])),r=project(expand([-6,-10]));
    ctx.save();ctx.globalAlpha=.61+.035*Math.sin(time*.8);
    ctx.transform((q[0]-p[0])/this.image.width,(q[1]-p[1])/this.image.width,(r[0]-p[0])/this.image.height,(r[1]-p[1])/this.image.height,p[0],p[1]);
    ctx.drawImage(this.image,0,0);ctx.restore();
  }
}
