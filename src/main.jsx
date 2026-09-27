import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { supabase } from "./lib/supabase";
import "./style.css";

function App() {
  const [session, setSession] = useState(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [message, setMessage] = useState("");
  const [lives, setLives] = useState([]);
  const [gifts, setGifts] = useState([]);
  const [selectedLive, setSelectedLive] = useState(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [giftFeed, setGiftFeed] = useState([]);
  const [comments, setComments] = useState([]);
  const [commentText, setCommentText] = useState("");
  const [dashboardOpen, setDashboardOpen] = useState(false);
  const [pendingPurchase, setPendingPurchase] = useState(null);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState("mtn_momo");
  const [payerPhone, setPayerPhone] = useState("");
  const [paymentBusy, setPaymentBusy] = useState(false);
  const viewerVideoRef = useRef(null);
  const peerRef = useRef(null);
  const videoRef = useRef(null);
  const streamRef = useRef(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (data.session) setDashboardOpen(true);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      if (next) setDashboardOpen(true);
    });
    loadData();
    const giftChannel = supabase.channel("sweet-live-gifts")
      .on("postgres_changes",{event:"*",schema:"public",table:"gift_purchases"},payload=>{
        if(payload.eventType==="INSERT") setGiftFeed(v=>[payload.new,...v].slice(0,20));
      }).subscribe();
    const commentChannel = supabase.channel("sweet-live-comments")
      .on("postgres_changes",{event:"INSERT",schema:"public",table:"live_comments"},payload=>{
        if (payload.new.live_id === selectedLive?.id) setComments(v=>[payload.new,...v].slice(0,50));
      }).subscribe();
    return () => {
      listener.subscription.unsubscribe();
      supabase.removeChannel(giftChannel);
      supabase.removeChannel(commentChannel);
    };
  }, []);

  useEffect(() => {
    if (selectedLive) loadComments(selectedLive.id);
  }, [selectedLive?.id]);

  async function loadData() {
    const [{ data: liveData }, { data: giftData }] = await Promise.all([
      supabase.from("live_streams").select("*, profiles(display_name,username)").eq("status","live").order("started_at",{ascending:false}),
      supabase.from("gifts").select("*").eq("active",true).order("price_xaf")
    ]);
    setLives(liveData || []);
    setGifts(giftData || []);
  }

  async function loadComments(liveId) {
    const { data } = await supabase.from("live_comments").select("*, profiles(display_name,username)").eq("live_id",liveId).order("created_at",{ascending:false}).limit(50);
    setComments(data || []);
  }

  async function authenticate(e) {
    e.preventDefault();
    setMessage("Connexion...");
    const result = mode === "signup"
      ? await supabase.auth.signUp({email,password,options:{data:{display_name:displayName,username:displayName.toLowerCase().replace(/[^a-z0-9_]/g,"_")}}})
      : await supabase.auth.signInWithPassword({email,password});
    if (result.error) {
      const raw=result.error.message||"Une erreur est survenue.", lower=raw.toLowerCase();
      let friendly=raw;
      if(lower.includes("rate limit")||lower.includes("too many")) friendly="Trop de tentatives. Attends quelques minutes puis réessaie.";
      else if(lower.includes("email not confirmed")) friendly="Compte créé mais e-mail non confirmé. Confirme ton e-mail puis reconnecte-toi.";
      else if(lower.includes("user already registered")) friendly="Ce compte existe déjà. Passe sur « Se connecter ».";
      else if(lower.includes("password")) friendly="Mot de passe refusé. Utilise au moins 6 caractères.";
      else if(lower.includes("fetch")||lower.includes("network")) friendly="Connexion au serveur impossible. Vérifie Internet puis réessaie.";
      setMessage(friendly); return;
    }
    if(mode==="signup") {
      const needsConfirmation=!result.data?.session;
      setMessage(needsConfirmation?"Compte créé. Confirme ton e-mail puis reconnecte-toi.":"Compte créé et connecté. Bienvenue sur Sweet Live.");
      if(!needsConfirmation) { setAuthOpen(false); setDashboardOpen(true); }
    } else { setMessage("Connecté."); setAuthOpen(false); setDashboardOpen(true); }
  }

  async function logout() {
    await supabase.auth.signOut();
    setDashboardOpen(false); setCameraOpen(false); stopCamera();
  }

  async function startLive() {
    if(!session){setAuthOpen(true);return;}
    const title=window.prompt("Titre de ton live :","Mon live Sweet Live");
    if(!title) return;
    const {data,error}=await supabase.from("live_streams").insert({host_id:session.user.id,title}).select("*, profiles(display_name,username)").single();
    if(error){setMessage(error.message);return;}
    setSelectedLive(data); setCameraOpen(true);
    const channel=supabase.channel("live-signal-"+data.id).on("broadcast",{event:"signal"},async({payload})=>{
      if(payload.type==="join"&&payload.sender_id!==session.user.id){
        const pc=new RTCPeerConnection({iceServers:[{urls:"stun:stun.l.google.com:19302"}]}); peerRef.current=pc;
        streamRef.current?.getTracks().forEach(t=>pc.addTrack(t,streamRef.current));
        pc.onicecandidate=async e=>{if(e.candidate) await supabase.from("live_signals").insert({live_id:data.id,sender_id:session.user.id,recipient_id:payload.sender_id,type:"ice",payload:e.candidate});};
        const offer=await pc.createOffer(); await pc.setLocalDescription(offer);
        await supabase.from("live_signals").insert({live_id:data.id,sender_id:session.user.id,recipient_id:payload.sender_id,type:"offer",payload:offer});
      }
    }).subscribe();
    setLives(v=>[data,...v]);
    setTimeout(async()=>{try{
      const media=await navigator.mediaDevices.getUserMedia({video:true,audio:true}); streamRef.current=media;
      if(videoRef.current) videoRef.current.srcObject=media;
    }catch{setMessage("Caméra/micro non autorisés. Autorise-les dans le navigateur.");}},100);
  }

  function stopCamera(){if(streamRef.current)streamRef.current.getTracks().forEach(t=>t.stop());streamRef.current=null;}

  async function openViewer(live) {
    if(!session){setAuthOpen(true);return;}
    setSelectedLive(live); setViewerOpen(true);
    const pc=new RTCPeerConnection({iceServers:[{urls:"stun:stun.l.google.com:19302"}]}); peerRef.current=pc;
    pc.ontrack=e=>{if(viewerVideoRef.current)viewerVideoRef.current.srcObject=e.streams[0];};
    pc.onicecandidate=async e=>{if(e.candidate)await supabase.from("live_signals").insert({live_id:live.id,sender_id:session.user.id,type:"ice",payload:e.candidate});};
    const channel=supabase.channel("live-signal-"+live.id).on("broadcast",{event:"signal"},async({payload})=>{
      if(payload.recipient_id&&payload.recipient_id!==session.user.id)return;
      if(payload.type==="offer"){await pc.setRemoteDescription(payload.payload);const answer=await pc.createAnswer();await pc.setLocalDescription(answer);await supabase.from("live_signals").insert({live_id:live.id,sender_id:session.user.id,recipient_id:payload.sender_id,type:"answer",payload:answer});}
      if(payload.type==="ice"&&payload.sender_id!==session.user.id){try{await pc.addIceCandidate(payload.payload);}catch{}}
    }).subscribe();
    await supabase.from("live_signals").insert({live_id:live.id,sender_id:session.user.id,type:"join",payload:{}});
    const {data:offers}=await supabase.from("live_signals").select("*").eq("live_id",live.id).eq("type","offer").order("created_at",{ascending:false}).limit(1);
    if(offers?.[0]){await pc.setRemoteDescription(offers[0].payload);const answer=await pc.createAnswer();await pc.setLocalDescription(answer);await supabase.from("live_signals").insert({live_id:live.id,sender_id:session.user.id,recipient_id:offers[0].sender_id,type:"answer",payload:answer});}
    loadComments(live.id);
  }

  async function endViewer(){if(peerRef.current)peerRef.current.close();peerRef.current=null;setViewerOpen(false);}

  async function endLive(){
    if(!selectedLive)return;
    await supabase.from("live_streams").update({status:"ended",ended_at:new Date().toISOString()}).eq("id",selectedLive.id);
    stopCamera();if(peerRef.current)peerRef.current.close();peerRef.current=null;setCameraOpen(false);setSelectedLive(null);loadData();
  }

  async function sendComment(){
    const content=commentText.trim();
    if(!session){setAuthOpen(true);return;}
    if(!selectedLive||!content)return;
    const {error}=await supabase.from("live_comments").insert({live_id:selectedLive.id,user_id:session.user.id,content});
    if(error)setMessage(error.message); else setCommentText("");
  }

  async function sendGift(gift, liveOverride=null){
    if(!session){setAuthOpen(true);return;}
    const live=liveOverride||selectedLive;
    if(!live){setMessage("Ouvre d'abord un live à soutenir.");return;}
    if(liveOverride) setSelectedLive(live);
    const {data,error}=await supabase.from("gift_purchases").insert({gift_id:gift.id,live_id:live.id,sender_id:session.user.id,host_id:live.host_id,amount_xaf:gift.price_xaf,payment_status:"pending"});
    if(error){setMessage(error.message);return;}
    setPendingPurchase(data);setPayerPhone("");setPaymentMethod("mtn_momo");setPaymentOpen(true);
  }

  async function payForGift(){
    if(!pendingPurchase)return;
    const phone=payerPhone.trim();
    if(!/^\+?2376\d{8}$/.test(phone.replace(/\s/g,""))&&!/^6\d{8}$/.test(phone.replace(/\s/g,""))){setMessage("Entre un numéro camerounais valide, par exemple +237 6XXXXXXXX.");return;}
    setPaymentBusy(true);setMessage("");
    const {data,error}=await supabase.functions.invoke("notchpay-create-gift",{body:{giftPurchaseId:pendingPurchase.id,phone,channel:paymentMethod==="mtn_momo"?"cm.mtn":"cm.orange",origin:window.location.origin}});
    setPaymentBusy(false);
    if(error){let detail=error.message||"Erreur de paiement.";try{if(error.context){const body=await error.context.text();if(body)detail+=" — "+body;}}catch{}setMessage(detail);return;}
    if(!data){setMessage("Le serveur de paiement n'a renvoyé aucune réponse.");return;}
    if(data?.authorization_url){window.location.href=data.authorization_url;return;}
    setMessage(data?.message||"Demande de paiement envoyée. Confirme-la sur ton téléphone.");setPaymentOpen(false);
  }

  const myLives=lives.filter(l=>l.host_id===session?.user?.id);
  const myGifts=giftFeed.filter(g=>g.sender_id===session?.user?.id);
  return <main className="app">
    <header>
      <div className="logo">♥</div><div className="brand"><h1>Sweet Live</h1><p>Lives, communauté et cadeaux.</p></div>
      <div className="account">{session?<><button className="small secondary" onClick={()=>setDashboardOpen(v=>!v)}>Tableau de bord</button><button className="small secondary" onClick={logout}>Déconnexion</button></>:<button className="small" onClick={()=>setAuthOpen(true)}>S'inscrire / Se connecter</button>}</div>
    </header>

    {session&&dashboardOpen&&<section className="dashboard">
      <div className="dashboardHead"><div><span className="badge">● ESPACE PERSONNEL</span><h2>Bonjour {session.user.user_metadata?.display_name||"Créateur"} 👋</h2><p>Tout ce qu'il te faut pour gérer ton activité Sweet Live.</p></div><button onClick={startLive}>🎥 Lancer un live</button></div>
      <div className="dashGrid">
        <article className="dashCard"><b>🔴</b><strong>{myLives.length}</strong><span>Mes lives en cours</span><button className="secondary small" onClick={()=>document.getElementById("lives").scrollIntoView({behavior:"smooth"})}>Voir les lives</button></article>
        <article className="dashCard"><b>💬</b><strong>{comments.length}</strong><span>Commentaires du live sélectionné</span><button className="secondary small" onClick={()=>selectedLive&&loadComments(selectedLive.id)}>Actualiser</button></article>
        <article className="dashCard"><b>🎁</b><strong>{myGifts.length}</strong><span>Cadeaux envoyés récents</span><button className="secondary small" onClick={()=>document.getElementById("giftFeed").scrollIntoView({behavior:"smooth"})}>Voir les cadeaux</button></article>
      </div>
      <div className="dashboardLinks"><button className="secondary" onClick={()=>document.getElementById("lives").scrollIntoView({behavior:"smooth"})}>🔴 Derniers lives</button><button className="secondary" onClick={()=>selectedLive&&loadComments(selectedLive.id)}>💬 Voir les commentaires</button><button className="secondary" onClick={()=>document.getElementById("giftFeed").scrollIntoView({behavior:"smooth"})}>🎁 Voir les cadeaux</button></div>
    </section>}

    <section className="hero"><span className="badge">● EN DIRECT</span><h2>Bienvenue sur <strong>Sweet Live</strong></h2><p>Crée ton compte, lance ton live et reçois des cadeaux de tes spectateurs.</p><div className="actions"><button onClick={startLive}>🎥 Commencer un live</button><button className="secondary" onClick={()=>document.getElementById("lives").scrollIntoView({behavior:"smooth"})}>🔴 Explorer les lives</button></div></section>

    {viewerOpen&&selectedLive&&<section className="studio"><div className="studioTop"><div><span className="badge">● SPECTATEUR</span><h2>{selectedLive.title}</h2></div><button onClick={endViewer}>Quitter</button></div><video ref={viewerVideoRef} autoPlay playsInline controls/><div className="comments"><h3>💬 Commentaires</h3><div className="commentList">{comments.map(c=><div className="comment" key={c.id}><b>{c.profiles?.display_name||"Utilisateur"}</b><span>{c.content}</span></div>)}</div><div className="commentForm"><input placeholder="Écrire un commentaire..." value={commentText} onChange={e=>setCommentText(e.target.value)} onKeyDown={e=>e.key==="Enter"&&sendComment()}/><button onClick={sendComment}>Envoyer</button></div></div><div className="giftRow">{gifts.map(g=><button className="gift" key={g.id} onClick={()=>sendGift(g)}>{g.emoji} {g.name}<small>{g.price_xaf.toLocaleString("fr-FR")} FCFA</small></button>)}</div></section>}

    {cameraOpen&&<section className="studio"><div className="studioTop"><div><span className="badge">● TON LIVE</span><h2>{selectedLive?.title}</h2></div><button onClick={endLive}>Terminer le live</button></div><video ref={videoRef} autoPlay playsInline muted/><p>Diffusion WebRTC active. Autorise caméra et micro pour démarrer.</p><div className="comments"><h3>💬 Commentaires</h3><div className="commentList">{comments.map(c=><div className="comment" key={c.id}><b>{c.profiles?.display_name||"Utilisateur"}</b><span>{c.content}</span></div>)}</div><div className="commentForm"><input placeholder="Répondre à tes spectateurs..." value={commentText} onChange={e=>setCommentText(e.target.value)} onKeyDown={e=>e.key==="Enter"&&sendComment()}/><button onClick={sendComment}>Envoyer</button></div></div></section>}

    <section id="lives" className="section"><div className="sectionTitle"><h2>Derniers lives</h2><button className="small secondary" onClick={loadData}>Actualiser</button></div>{lives.length===0?<p className="empty">Aucun live pour le moment. Sois le premier à démarrer.</p>:<div className="liveGrid">{lives.map(l=><article className="liveCard" key={l.id} onClick={()=>openViewer(l)}><span className="badge">● LIVE</span><h3>{l.title}</h3><p>👤 {l.profiles?.display_name||l.profiles?.username||"Créateur"}</p><button className="small" onClick={e=>{e.stopPropagation();openViewer(l)}}>Regarder</button><div className="giftRow">{gifts.slice(0,3).map(g=><button className="gift mini" key={g.id} onClick={e=>{e.stopPropagation();sendGift(g,l)}}>{g.emoji} {g.price_xaf} FCFA</button>)}</div></article>)}</div>}</section>

    {paymentOpen&&pendingPurchase&&<div className="modal"><div className="modalBox"><button className="close" onClick={()=>!paymentBusy&&setPaymentOpen(false)}>×</button><h2>🎁 Payer le cadeau</h2><p>Montant : <strong>{pendingPurchase.amount_xaf.toLocaleString("fr-FR")} FCFA</strong></p><label>Mode de paiement</label><select value={paymentMethod} onChange={e=>setPaymentMethod(e.target.value)} disabled={paymentBusy}><option value="mtn_momo">MTN Mobile Money</option><option value="orange_money">Orange Money</option></select><label>Numéro Mobile Money</label><input inputMode="tel" placeholder="+237 6XXXXXXXX" value={payerPhone} onChange={e=>setPayerPhone(e.target.value)} disabled={paymentBusy}/><button onClick={payForGift} disabled={paymentBusy}>{paymentBusy?"Envoi de la demande...":"💳 Payer maintenant"}</button><p className="formMessage">Une demande de confirmation sera envoyée sur ton téléphone.</p></div></div>}

    {giftFeed.length>0&&<section id="giftFeed" className="section"><h2>🎁 Cadeaux en temps réel</h2><div className="giftRow">{giftFeed.slice(0,8).map(g=><span className="gift mini" key={g.id}>🎁 {g.amount_xaf.toLocaleString("fr-FR")} FCFA</span>)}</div></section>}

    {message&&<div className="toast" onClick={()=>setMessage("")}>{message}</div>}

    {authOpen&&<div className="modal"><div className="modalBox"><button className="close" onClick={()=>setAuthOpen(false)}>×</button><h2>{mode==="signup"?"Créer ton compte":"Se connecter"}</h2>{mode==="signup"&&<input placeholder="Nom d'affichage" value={displayName} onChange={e=>setDisplayName(e.target.value)} required/>}<input type="email" placeholder="E-mail" value={email} onChange={e=>setEmail(e.target.value)} required/><input type="password" placeholder="Mot de passe (6+ caractères)" value={password} onChange={e=>setPassword(e.target.value)} required/><button onClick={authenticate}>{mode==="signup"?"Créer mon compte":"Connexion"}</button><button className="secondary" onClick={()=>setMode(mode==="signup"?"login":"signup")}>{mode==="signup"?"J'ai déjà un compte":"Créer un compte"}</button>{message&&<p className="formMessage">{message}</p>}</div></div>}
  </main>;
}
createRoot(document.getElementById("root")).render(<App />);