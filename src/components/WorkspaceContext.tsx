import {createContext,useContext,useEffect,useState,type ReactNode} from 'react'
import {getWorkspace,type Workspace} from '../services/workspace'
import {errorMessage} from '../lib/commerce'
const Context=createContext<{workspace:Workspace;refresh:()=>Promise<void>}|null>(null)
export function useWorkspace(){const value=useContext(Context);if(!value) throw new Error('Workspace has not loaded');return value}
export default function WorkspaceProvider({businessId,children}:{businessId:string;children:ReactNode}){
 const [workspace,setWorkspace]=useState<Workspace|null>(null),[error,setError]=useState('')
 async function refresh(){try{const next=await getWorkspace(businessId);setWorkspace(next);setError('')}catch(e){setError(errorMessage(e));throw e}}
 useEffect(()=>{let active=true;getWorkspace(businessId).then(w=>{if(active)setWorkspace(w)}).catch(e=>{if(active)setError(errorMessage(e))});return()=>{active=false}},[businessId])
 if(!workspace) return <main className="loading-page" role="status"><h2>{error?'Your workspace could not load':'Opening your workspace…'}</h2>{error&&<><p role="alert">{error}</p><button className="primary-button" onClick={()=>refresh().catch(()=>{})}>Try again</button></>}</main>
 return <Context.Provider value={{workspace,refresh}}>{error&&<div className="banner warning" role="alert">Latest usage could not refresh: {error}. Paid actions will still be checked by the server.</div>}{children}</Context.Provider>
}
