import {sendMail} from '../_shared/mail.ts'
Deno.serve((req:Request)=>sendMail(req,false))
