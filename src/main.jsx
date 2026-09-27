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
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    loadData();
    const giftChannel = supabase.channel("sweet-live-gifts").on("postgres_changes",{event:"*",schema:"public",table:"gift_purchases"},payload=>{ if(payload.eventType==="INSERT") setGiftFeed(v=>[payload.new,...v].slice(0,20)); if(payload.eventType==="UPDATE" && pendingPurchase?.id===payload.new.id) setPendingPurchase(payload.new); }).subscribe();
    return () => { listener.subscription.unsubscribe(); supabase.removeChannel(giftChannel); };

  }, []);

  async function loadData() {
    const [{ data: liveData }, { data: giftData }] = await Promise.all([
      supabase.from("live_streams").select("*, profiles(display_name,username)").eq("status", "live").order("started_at", { ascending: false }),
      supabase.from("gifts").select("*").eq("active", true).order("price_xaf")
    ]);
    setLives(liveData || []);
    setGifts(giftData || []);
  }

  async function authenticate(e) {
    e.preventDefault();
    setMessage("Connexion...");
    const result = mode === "signup"
      ? await supabase.auth.signUp({ email, password, options: { data: { display_name: displayName, username: displayName.toLowerCase().replace(/[^a-z0-9_]/g, "_") } } })
      : await supabase.auth.signInWithPassword({ email, password });
    if (result.error) setMessage(result.error.message);
    else {
      setMessage(mode === "signup" ? "Compte créé. Vérifie ton e-mail si Supabase le demande." : "Connecté.");
      if (mode === "login") setAuthOpen(false);
    }
  }

  async function logout() { await supabase.auth.signOut(); setCameraOpen(false); stopCamera(); }

  async function startLive() {
    if (!session) { setAuthOpen(true); return; }
    const title = window.prompt("Titre de ton live :", "Mon live Sweet Live");
    if (!title) return;
    const { data, error } = await supabase.from("live_streams").insert({ host_id: session.user.id, title }).select("*, profiles(display_name,username)").single();
    if (error) { setMessage(error.message); return; }
    setSelectedLive(data);
    setCameraOpen(true);
    const channel = supabase.channel("live-signal-"+data.id).on("broadcast",{event:"signal"},async ({payload})=>{
      if (payload.type === "join" && payload.sender_id !== session.user.id) {
        const pc=new RTCPeerConnection({iceServers:[{urls:"stun:stun.l.google.com:19302"}]}); peerRef.current=pc;
        streamRef.current?.getTracks().forEach(t=>pc.addTrack(t,streamRef.current));
        pc.onicecandidate=async e=>{if(e.candidate) await supabase.from("live_signals").insert({live_id:data.id,sender_id:session.user.id,recipient_id:payload.sender_id,type:"ice",payload:e.candidate});};
        const offer=await pc.createOffer(); await pc.setLocalDescription(offer); await supabase.from("live_signals").insert({live_id:data.id,sender_id:session.user.id,recipient_id:payload.sender_id,type:"offer",payload:offer});
      }
    }).subscribe();
    setLives((v) => [data, ...v]);
    setTimeout(async () => {
      try {
        const media = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        streamRef.current = media;
        if (videoRef.current) videoRef.current.srcObject = media;
      } catch (e) { setMessage("Caméra/micro non autorisés. Le live est créé, mais la caméra doit être autorisée."); }
    }, 100);
  }

  function stopCamera() {
    if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  }

  async function openViewer(live) {
    if (!session) { setAuthOpen(true); return; }
    setSelectedLive(live); setViewerOpen(true);
    const pc = new RTCPeerConnection({iceServers:[{urls:"stun:stun.l.google.com:19302"}]});
    peerRef.current = pc;
    pc.ontrack = (e) => { if (viewerVideoRef.current) viewerVideoRef.current.srcObject = e.streams[0]; };
    pc.onicecandidate = async (e) => { if (e.candidate) await supabase.from("live_signals").insert({live_id:live.id,sender_id:session.user.id,type:"ice",payload:e.candidate}); };
    const channel = supabase.channel("live-signal-"+live.id).on("broadcast",{event:"signal"},async ({payload})=>{
      if (payload.recipient_id && payload.recipient_id !== session.user.id) return;
      if (payload.type === "offer") { await pc.setRemoteDescription(payload.payload); const answer=await pc.createAnswer(); await pc.setLocalDescription(answer); await supabase.from("live_signals").insert({live_id:live.id,sender_id:session.user.id,recipient_id:payload.sender_id,type:"answer",payload:answer}); }
      if (payload.type === "ice" && payload.sender_id !== session.user.id) { try { await pc.addIceCandidate(payload.payload); } catch {} }
    }).subscribe();
    await supabase.from("live_signals").insert({live_id:live.id,sender_id:session.user.id,type:"join",payload:{}});
    const {data:offers}=await supabase.from("live_signals").select("*").eq("live_id",live.id).eq("type","offer").order("created_at",{ascending:false}).limit(1);
    if (offers?.[0]) { await pc.setRemoteDescription(offers[0].payload); const answer=await pc.createAnswer(); await pc.setLocalDescription(answer); await supabase.from("live_signals").insert({live_id:live.id,sender_id:session.user.id,recipient_id:offers[0].sender_id,type:"answer",payload:answer}); }
  }

  async function endViewer() { if (peerRef.current) peerRef.current.close(); peerRef.current=null; setViewerOpen(false); }

  async function endLive() {
    if (!selectedLive) return;
    await supabase.from("live_streams").update({ status: "ended", ended_at: new Date().toISOString() }).eq("id", selectedLive.id);
    stopCamera(); if(peerRef.current) peerRef.current.close(); peerRef.current=null; setCameraOpen(false); setSelectedLive(null); loadData();
  }

  async function sendGift(gift) {
    if (!session) { setAuthOpen(true); return; }
    if (!selectedLive) { setMessage("Ouvre d'abord un live à soutenir."); return; }
    const { data, error } = await supabase.from("gift_purchases").insert({
      gift_id: gift.id, live_id: selectedLive.id, sender_id: session.user.id,
      host_id: selectedLive.host_id, amount_xaf: gift.price_xaf, payment_status: "pending"
    }).select("*").single();
    if (error) { setMessage(error.message); return; }
    setPendingPurchase(data);
    setPayerPhone("");
    setPaymentMethod("mtn_momo");
    setPaymentOpen(true);
  }

  async function payForGift() {
    if (!pendingPurchase) return;
    const phone = payerPhone.trim();
    if (!/^\+?2376\d{8}$/.test(phone.replace(/\s/g, "")) && !/^6\d{8}$/.test(phone.replace(/\s/g, ""))) {
      setMessage("Entre un numéro camerounais valide, par exemple +237 6XXXXXXXX.");
      return;
    }
    setPaymentBusy(true);
    setMessage("");
    const { data, error } = await supabase.functions.invoke("notchpay-create-gift", {
      body: {
        giftPurchaseId: pendingPurchase.id,
        phone,
        channel: paymentMethod === "mtn_momo" ? "cm.mtn" : "cm.orange",
        origin: window.location.origin
      }
    });
    setPaymentBusy(false);
    if (error) {
      let detail = error.message || "Erreur de paiement.";
      try {
        if (error.context) {
          const body = await error.context.text();
          if (body) detail += " — " + body;
        }
      } catch {}
      setMessage(detail);
      return;
    }
    if (!data) {
      setMessage("Le serveur de paiement n'a renvoyé aucune réponse.");
      return;
    }
    if (data?.authorization_url) {
      window.location.href = data.authorization_url;
      return;
    }
    setMessage(data?.message || "Demande de paiement envoyée. Confirme-la sur ton téléphone.");
    setPaymentOpen(false);
  }

  return <main className="app">
    <header>
      <div className="logo">♥</div>
      <div className="brand"><h1>Sweet Live</h1><p>Lives, communauté et cadeaux.</p></div>
      <div className="account">{session ? <button className="small secondary" onClick={logout}>Déconnexion</button> : <button className="small" onClick={() => setAuthOpen(true)}>S'inscrire / Se connecter</button>}</div>
    </header>

    <section className="hero">
      <span className="badge">● EN DIRECT</span>
      <h2>Bienvenue sur <strong>Sweet Live</strong></h2>
      <p>Crée ton compte, lance ton live et reçois des cadeaux de tes spectateurs.</p>
      <div className="actions">
        <button onClick={startLive}>🎥 Commencer un live</button>
        <button className="secondary" onClick={() => document.getElementById("lives").scrollIntoView({behavior:"smooth"})}>🔴 Explorer les lives</button>
      </div>
    </section>

    {viewerOpen && selectedLive && <section className="studio"><div className="studioTop"><div><span className="badge">● SPECTATEUR</span><h2>{selectedLive.title}</h2></div><button onClick={endViewer}>Quitter</button></div><video ref={viewerVideoRef} autoPlay playsInline controls /><div className="giftRow">{gifts.map(g=><button className="gift" key={g.id} onClick={()=>sendGift(g)}>{g.emoji} {g.name}<small>{g.price_xaf.toLocaleString("fr-FR")} FCFA</small></button>)}</div></section>}

    {cameraOpen && <section className="studio">
      <div className="studioTop"><div><span className="badge">● TON LIVE</span><h2>{selectedLive?.title}</h2></div><button onClick={endLive}>Terminer le live</button></div>
      <video ref={videoRef} autoPlay playsInline muted />
      <p>Diffusion WebRTC active pour les spectateurs compatibles. Autorise caméra et micro pour démarrer.</p>
      <div className="giftRow">{gifts.map(g => <button className="gift" key={g.id} onClick={() => sendGift(g)}>{g.emoji} {g.name}<small>{g.price_xaf.toLocaleString("fr-FR")} FCFA</small></button>)}</div>
    </section>}

    <section id="lives" className="section">
      <div className="sectionTitle"><h2>Lives en cours</h2><button className="small secondary" onClick={loadData}>Actualiser</button></div>
      {lives.length === 0 ? <p className="empty">Aucun live pour le moment. Sois le premier à démarrer.</p> :
      <div className="liveGrid">{lives.map(l => <article className="liveCard" key={l.id} onClick={() => setSelectedLive(l)}>
        <span className="badge">● LIVE</span><h3>{l.title}</h3><p>👤 {l.profiles?.display_name || l.profiles?.username || "Créateur"}</p>
        <div className="giftRow">{gifts.slice(0,3).map(g => <button className="gift mini" key={g.id} onClick={(e)=>{e.stopPropagation(); openViewer(l); sendGift(g)}}>{g.emoji} {g.price_xaf} FCFA</button>)}</div>
      </article>)}</div>}
    </section>

    {paymentOpen && pendingPurchase && <div className="modal"><div className="modalBox">
      <button className="close" onClick={()=>!paymentBusy&&setPaymentOpen(false)}>×</button>
      <h2>🎁 Payer le cadeau</h2>
      <p>Montant : <strong>{pendingPurchase.amount_xaf.toLocaleString("fr-FR")} FCFA</strong></p>
      <label>Mode de paiement</label>
      <select value={paymentMethod} onChange={e=>setPaymentMethod(e.target.value)} disabled={paymentBusy}>
        <option value="mtn_momo">MTN Mobile Money</option>
        <option value="orange_money">Orange Money</option>
      </select>
      <label>Numéro Mobile Money</label>
      <input inputMode="tel" placeholder="+237 6XXXXXXXX" value={payerPhone} onChange={e=>setPayerPhone(e.target.value)} disabled={paymentBusy} />
      <button onClick={payForGift} disabled={paymentBusy}>{paymentBusy ? "Envoi de la demande..." : "💳 Payer maintenant"}</button>
      <p className="formMessage">Une demande de confirmation sera envoyée sur ton téléphone.</p>
    </div></div>}

    {giftFeed.length>0 && <section className="section"><h2>Cadeaux en temps réel</h2><div className="giftRow">{giftFeed.slice(0,8).map(g=><span className="gift mini" key={g.id}>🎁 {g.amount_xaf.toLocaleString("fr-FR")} FCFA</span>)}</div></section>}

    <section className="cards">
      <article><b>🔴</b><h3>Lives</h3><p>Découvre les diffusions en direct.</p></article>
      <article><b>💬</b><h3>Communauté</h3><p>Échange avec les autres utilisateurs.</p></article>
      <article><b>🎁</b><h3>Cadeaux</h3><p>Envoie des cadeaux virtuels aux créateurs.</p></article>
    </section>

    {message && <div className="toast" onClick={() => setMessage("")}>{message}</div>}

    {authOpen && <div className="modal"><div className="modalBox"><button className="close" onClick={()=>setAuthOpen(false)}>×</button>
      <h2>{mode === "signup" ? "Créer ton compte" : "Se connecter"}</h2>
      {mode === "signup" && <input placeholder="Nom d'affichage" value={displayName} onChange={e=>setDisplayName(e.target.value)} required />}
      <input type="email" placeholder="E-mail" value={email} onChange={e=>setEmail(e.target.value)} required />
      <input type="password" placeholder="Mot de passe (6+ caractères)" value={password} onChange={e=>setPassword(e.target.value)} required />
      <button onClick={authenticate}>{mode === "signup" ? "Créer mon compte" : "Connexion"}</button>
      <button className="secondary" onClick={()=>setMode(mode==="signup"?"login":"signup")}>{mode==="signup"?"J'ai déjà un compte":"Créer un compte"}</button>
      {message && <p className="formMessage">{message}</p>}
    </div></div>}
  </main>
}
createRoot(document.getElementById("root")).render(<App />);