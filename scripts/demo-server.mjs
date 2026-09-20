import http from 'node:http';
import fs from 'node:fs';
const html=fs.readFileSync(new URL('../docs/demo.html',import.meta.url));
http.createServer((_req,res)=>{res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(html);}).listen(43124,'127.0.0.1',()=>console.log('Demo article: http://127.0.0.1:43124'));
