import {Component,type ReactNode} from 'react'
export default class ErrorBoundary extends Component<{children:ReactNode},{failed:boolean}>{
 state={failed:false}
 static getDerivedStateFromError(){return {failed:true}}
 render(){if(this.state.failed)return <main className="loading-page"><h1>Owedly could not display this screen.</h1><p>No action should be assumed complete. Reload, then check your document or payment history before submitting again.</p><button className="primary-button" onClick={()=>location.reload()}>Reload Owedly</button></main>;return this.props.children}
}
