import {authenticate,preflight,response,failure,AccessError,uuid} from '../_shared/access.ts'
Deno.serve(async(req:Request)=>{
 const early=preflight(req);if(early)return early
 try{
  const {db}=await authenticate(req)
  const body=await req.json(),id=String(body.action_id||'')
  if(!uuid.test(id))throw new AccessError('A valid action ID is required.',400)
  // The SQL transaction locks the proposal, verifies Pro, user and membership,
  // requires confirmation for writes, and saves the result before committing.
  const {data,error}=await db.rpc('execute_confirmed_action',{target_action_id:id})
  if(error)throw new AccessError(error.message,error.code==='42501'?403:409)
  return response(req,200,data)
 }catch(e){return failure(req,e)}
})
