export interface ResourceLease<T>{value:T;release:()=>void}
export class SkinFetchQueue{
  private active=0
  private concurrency:number
  private pending:Array<{priority:number;start:()=>void}>=[]
  constructor(concurrency=2){this.concurrency=concurrency}
  run<T>(signal:AbortSignal,priority:RequestPriority,task:()=>Promise<T>):Promise<T>{
    signal.throwIfAborted()
    return new Promise<T>((resolve,reject)=>{
      const abort=()=>{const index=this.pending.indexOf(job);if(index>=0)this.pending.splice(index,1);reject(signal.reason)}
      const job={priority:priority==='high'?0:priority==='low'?2:1,start:()=>{
        signal.removeEventListener('abort',abort);this.active++
        void Promise.resolve().then(()=>{signal.throwIfAborted();return task()}).then(resolve,reject).finally(()=>{this.active--;this.drain()})
      }}
      this.pending.push(job);signal.addEventListener('abort',abort,{once:true});this.drain()
    })
  }
  private drain(){this.pending.sort((a,b)=>a.priority-b.priority);while(this.active<this.concurrency&&this.pending.length)this.pending.shift()!.start()}
}
interface Entry<T>{promise:Promise<T>;controller:AbortController;refs:number;value?:T;settled:boolean;used:number;weight:number}

/** Active consumers own leases. Unused resources are retained in a bounded LRU.
 * Cancelling one consumer never aborts a resource still used by another. */
export class SkinResourceCache<T>{
  private entries=new Map<string,Entry<T>>()
  private limit:number
  private maxEntries:number
  private weight:(value:T)=>number
  private dispose:(value:T)=>void
  constructor(limit:number,maxEntries:number,weight:(value:T)=>number,dispose:(value:T)=>void){this.limit=limit;this.maxEntries=maxEntries;this.weight=weight;this.dispose=dispose}
  async acquire(key:string,create:(signal:AbortSignal)=>Promise<T>,signal:AbortSignal):Promise<ResourceLease<T>>{
    signal.throwIfAborted()
    let entry=this.entries.get(key)
    if(!entry){
      const controller=new AbortController()
      const next:Entry<T>={promise:undefined!,controller,refs:0,settled:false,used:performance.now(),weight:0}
      next.promise=Promise.resolve().then(()=>create(controller.signal)).then(value=>{
        if(this.entries.get(key)!==next){this.dispose(value);throw new DOMException('Resource cancelled','AbortError')}
        next.value=value;next.settled=true;next.weight=this.weight(value);this.trim();return value
      },error=>{next.settled=true;if(this.entries.get(key)===next)this.entries.delete(key);throw error})
      void next.promise.catch(()=>{})
      this.entries.set(key,next);entry=next
    }
    const owned=entry;owned.refs++;owned.used=performance.now()
    let released=false
    const release=()=>{
      if(released)return
      released=true;owned.refs--;owned.used=performance.now()
      if(!owned.refs&&!owned.settled){owned.controller.abort();if(this.entries.get(key)===owned)this.entries.delete(key)}
      this.trim()
    }
    try{
      const value=await new Promise<T>((resolve,reject)=>{
        const abort=()=>reject(signal.reason)
        signal.addEventListener('abort',abort,{once:true})
        owned.promise.then(value=>{signal.removeEventListener('abort',abort);resolve(value)},error=>{signal.removeEventListener('abort',abort);reject(error)})
        if(signal.aborted)abort()
      })
      signal.throwIfAborted()
      return {value,release}
    }catch(error){release();throw error}
  }
  private trim(){
    let size=Array.from(this.entries.values()).reduce((sum,e)=>sum+e.weight,0)
    for(const [key,entry]of [...this.entries].sort((a,b)=>a[1].used-b[1].used)){
      if(size<=this.limit&&this.entries.size<=this.maxEntries)break
      if(entry.refs||!entry.settled)continue
      this.entries.delete(key);size-=entry.weight
      if(entry.value!==undefined)this.dispose(entry.value)
    }
  }
  stats(){return {entries:this.entries.size,leased:Array.from(this.entries.values()).reduce((n,e)=>n+e.refs,0),weight:Array.from(this.entries.values()).reduce((n,e)=>n+e.weight,0)}}
}
