import {DurableObject} from 'cloudflare:workers';

// NFC tags carry fixed URLs (/t/07), so the whole exhibition is one room: every tap goes to the console(s) connected to it.
const ROOM='main';
const ACK_TIMEOUT_MS=6000;

// Relays a phone tap to the console over a hibernating WebSocket and returns the console's answer to the phone.
export class Relay extends DurableObject{
  constructor(ctx,env){
    super(ctx,env);
    this.pending=new Map();
    // Console keep-alive pings are answered by the runtime without waking the object.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping','pong'));
  }

  async fetch(request){
    const {pathname}=new URL(request.url);
    if(pathname==='/api/relay/console'){
      if(request.headers.get('Upgrade')!=='websocket')return new Response('expected a WebSocket upgrade',{status:426});
      const [client,server]=Object.values(new WebSocketPair());
      this.ctx.acceptWebSocket(server);
      return new Response(null,{status:101,webSocket:client});
    }
    if(pathname==='/api/relay/tap'&&request.method==='POST'){
      const {card}=await request.json().catch(()=>({}));
      if(typeof card!=='string'||!/^\d{2}$/.test(card))return Response.json({status:'bad_card'},{status:400});
      const consoles=this.ctx.getWebSockets();
      if(!consoles.length)return Response.json({status:'offline'});
      const id=crypto.randomUUID();
      // The first console to answer wins; the request stays open until then, which keeps the object awake.
      const answer=new Promise(resolve=>{this.pending.set(id,resolve);setTimeout(()=>resolve({status:'timeout'}),ACK_TIMEOUT_MS)});
      for(const ws of consoles){try{ws.send(JSON.stringify({type:'tap',id,card}))}catch{}}
      const ack=await answer;
      this.pending.delete(id);
      return Response.json(ack);
    }
    return new Response('not found',{status:404});
  }

  webSocketMessage(ws,message){
    let data;
    try{data=JSON.parse(message)}catch{return}
    if(data?.type==='ack')this.pending.get(data.id)?.({status:data.status,card:data.card,ai:data.ai});
  }
}

export default{
  async fetch(request,env){
    const url=new URL(request.url);
    // NFC tag URL → the phone page; it reads the card id from its own path.
    if(/^\/t\/\d{1,2}\/?$/.test(url.pathname))return env.ASSETS.fetch(new Request(new URL('/tap',url),request));
    if(url.pathname.startsWith('/api/relay/'))return env.RELAY.getByName(ROOM).fetch(request);
    // Anything else that is not a static file (e.g. printer/server.py's /api/*) is a 404, so bridge.js falls back to the simulated print.
    return env.ASSETS.fetch(request);
  }
};
