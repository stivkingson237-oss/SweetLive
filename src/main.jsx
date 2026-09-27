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
  const videoRef = useRef(null);
  const streamRef = useRef(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    loadData();
    return () => listener.subscription.unsubscribe();
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

  async function endLive() {
    if (!selectedLive) return;
    await supabase.from("live_streams").update({ status: "ended", ended_at: new Date().toISOString() }).eq("id", selectedLive.id);
    stopCamera(); setCameraOpen(false); setSelectedLive(null); loadData();
  }

  async function sendGift(gift) {
    if (!session) { setAuthOpen(true); return; }
    if (!selectedLive) { setMessage("Ouvre d'abord un live à soutenir."); return; }
    const { error } = await supabase.from("gift_purchases").insert({
      gift_id: gift.id, live_id: selectedLive.id, sender_id: session.user.id,
      host_id: selectedLive.host_id, amount_xaf: gift.price_xaf, payment_status: "pending"
    });
    if (error) setMessage(error.message);
    else setMessage(gift.name + " ajouté au paiement. Choisis MTN MoMo ou Orange Money dans l'étape de paiement.");
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

    {cameraOpen && <section className="studio">
      <div className="studioTop"><div><span className="badge">● TON LIVE</span><h2>{selectedLive?.title}</h2></div><button onClick={endLive}>Terminer le live</button></div>
      <video ref={videoRef} autoPlay playsInline muted />
      <p>Prévisualisation caméra active. La diffusion publique vidéo nécessite ensuite un serveur de streaming/WebRTC.</p>
      <div className="giftRow">{gifts.map(g => <button className="gift" key={g.id} onClick={() => sendGift(g)}>{g.emoji} {g.name}<small>{g.price_xaf.toLocaleString("fr-FR")} FCFA</small></button>)}</div>
    </section>}

    <section id="lives" className="section">
      <div className="sectionTitle"><h2>Lives en cours</h2><button className="small secondary" onClick={loadData}>Actualiser</button></div>
      {lives.length === 0 ? <p className="empty">Aucun live pour le moment. Sois le premier à démarrer.</p> :
      <div className="liveGrid">{lives.map(l => <article className="liveCard" key={l.id} onClick={() => setSelectedLive(l)}>
        <span className="badge">● LIVE</span><h3>{l.title}</h3><p>👤 {l.profiles?.display_name || l.profiles?.username || "Créateur"}</p>
        <div className="giftRow">{gifts.slice(0,3).map(g => <button className="gift mini" key={g.id} onClick={(e)=>{e.stopPropagation(); setSelectedLive(l); sendGift(g)}}>{g.emoji} {g.price_xaf} FCFA</button>)}</div>
      </article>)}</div>}
    </section>

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