// Restrict uploads to bounded uncompressed PCM. Do not trust caller-reported duration.
export function wavDuration(bytes:Uint8Array):number{
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),text=(at:number,n:number)=>new TextDecoder().decode(bytes.subarray(at,at+n))
 if(bytes.length<44||text(0,4)!=='RIFF'||text(8,4)!=='WAVE'||view.getUint32(4,true)+8!==bytes.length)throw new Error('Use the in-app recorder: a valid PCM WAV file is required.')
 let offset=12,format=false,dataBytes=0,foundData=false
 while(offset+8<=bytes.length){const name=text(offset,4),size=view.getUint32(offset+4,true),start=offset+8;if(size>bytes.length-start)throw new Error('Invalid audio length.')
  if(name==='fmt '){if(format||size<16||view.getUint16(start,true)!==1||view.getUint16(start+2,true)!==1||view.getUint32(start+4,true)!==16000||view.getUint32(start+8,true)!==32000||view.getUint16(start+12,true)!==2||view.getUint16(start+14,true)!==16)throw new Error('Use mono 16 kHz 16-bit PCM audio.');format=true}
  if(name==='data'){if(foundData||size%2)throw new Error('Invalid audio data.');dataBytes=size;foundData=true}
  offset=start+size+(size%2)
 }
 const duration=dataBytes/32000
 if(!format||!foundData||duration<=0||duration>61||offset!==bytes.length)throw new Error('Record one minute or less.')
 return duration
}
