// Export a separate PDF copy. The source PDF and local editable marks stay intact.
export async function annotatedPDF(bytes,strokes,title,library){
 const lib=library||await import('./vendor/pdf-lib/pdf-lib.min.mjs');
 const {PDFDocument,rgb,LineCapStyle,LineJoinStyle,pushGraphicsState,popGraphicsState,setStrokingColor,setLineWidth,setLineCap,setLineJoin,moveTo,lineTo,stroke}=lib;
 const doc=await PDFDocument.load(bytes,{updateMetadata:false});const pages=doc.getPages();
 for(const mark of strokes){const page=pages[mark.page-1];if(!page)continue;const color=rgb(...[1,3,5].map(i=>parseInt(mark.color.slice(i,i+2),16)/255));
  if(mark.points.length===1){page.drawCircle({x:mark.points[0][0],y:mark.points[0][1],size:mark.width/2,color});continue;}
  page.pushOperators(pushGraphicsState(),setStrokingColor(color),setLineWidth(mark.width),setLineCap(LineCapStyle.Round),setLineJoin(LineJoinStyle.Round),moveTo(...mark.points[0]),...mark.points.slice(1).map(p=>lineTo(...p)),stroke(),popGraphicsState());
 }
 doc.setTitle(title);return doc.save();
}
