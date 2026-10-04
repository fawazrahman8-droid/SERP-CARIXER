// Automatic provider ranking checks have been retired. No provider calls or database writes.
Deno.serve(req=>new Response(req.method==='OPTIONS'?null:JSON.stringify({error:'Automatic ranking checks have been removed. Use manual entry.'}),{
 status:req.method==='OPTIONS'?204:410,
 headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'https://serp-gray.vercel.app','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS','Cache-Control':'no-store'}
}));
