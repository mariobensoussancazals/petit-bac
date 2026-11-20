
import React, { useEffect, useState } from "react";
import { supabase } from "./supabase";

const LETTERS = "ABCDEFGHIJKLMNOPRSTUV";

function makeCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const values = new Uint32Array(6);
  crypto.getRandomValues(values);
  return Array.from(values, n => chars[n % chars.length]).join("");
}

export default function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pseudo, setPseudo] = useState("");
  const [code, setCode] = useState("");
  const [room, setRoom] = useState(null);
  const [players, setPlayers] = useState([]);
  const [answers, setAnswers] = useState({});
  const [answersReady, setAnswersReady] = useState(false);
  const [results, setResults] = useState([]);
  const [votes, setVotes] = useState([]);
  const [chat, setChat] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [stats, setStats] = useState([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [spinning, setSpinning] = useState(false);
  const [fakeLetter, setFakeLetter] = useState("A");

  const userId = session?.user?.id;
  const isHost = !!room && room.host_id === userId;
  const categories = room?.categories || [];
  const playing = room?.status === "playing";
  const reviewing = room?.status === "review";
  const finished = room?.status === "finished";
  const finalized = !!room?.review_finalized;

  const allFilled =
    categories.length === 6 &&
    categories.every(c => (answers[c] || "").trim().length > 0);

  const panel = {
    marginTop: 24,
    padding: 22,
    border: "1px solid #ddd",
    borderRadius: 12,
    textAlign: "left"
  };

  const field = {
    width: "100%",
    boxSizing: "border-box",
    marginTop: 7,
    marginBottom: 15
  };

  const fullButton = {
    width: "100%",
    marginTop: 12
  };

  // AUTHENTIFICATION

  useEffect(() => {
    let active = true;

    supabase.auth.getSession().then(({ data, error }) => {
      if (!active) return;
      if (error) setMessage(error.message);
      setSession(data?.session || null);
      setLoading(false);
    });

    const { data: listener } =
      supabase.auth.onAuthStateChange((_event, next) => {
        setSession(next);
      });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  // PROFIL

  useEffect(() => {
    if (!userId) {
      setPseudo("");
      setRoom(null);
      return;
    }

    let active = true;

    supabase
      .from("profiles")
      .select("username")
      .eq("id", userId)
      .maybeSingle()
      .then(({ data }) => {
        if (active) setPseudo(data?.username || "");
      });

    return () => {
      active = false;
    };
  }, [userId]);

  async function handleAuth(action) {
    if (!email.trim() || !password) {
      setMessage("Entre ton e-mail et ton mot de passe.");
      return;
    }

    setBusy(true);
    setMessage("");

    try {
      const { error } =
        action === "signup"
          ? await supabase.auth.signUp({
              email: email.trim(),
              password
            })
          : await supabase.auth.signInWithPassword({
              email: email.trim(),
              password
            });

      if (error) throw error;

      if (action === "signup") {
        setMessage("Compte créé ! Vérifie ton e-mail si nécessaire.");
      }
    } catch (e) {
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function savePseudo() {
    if (!userId || !pseudo.trim()) {
      setMessage("Choisis un pseudo.");
      return;
    }

    setBusy(true);
    setMessage("");

    try {
      const { error } = await supabase
        .from("profiles")
        .upsert({
          id: userId,
          username: pseudo.trim()
        });

      if (error) throw error;
      setMessage("Pseudo enregistré !");
    } catch (e) {
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  }

  // SALONS

  async function createRoom() {
    if (!userId || !pseudo.trim()) {
      setMessage("Enregistre un pseudo avant de jouer.");
      return;
    }

    setBusy(true);
    setMessage("");

    try {
      let created = null;

      for (let i = 0; i < 5; i++) {
        const { data, error } = await supabase
          .from("rooms")
          .insert({
            code: makeCode(),
            host_id: userId,
            status: "waiting"
          })
          .select()
          .single();

        if (!error) {
          created = data;
          break;
        }

        if (error.code !== "23505") throw error;
      }

      if (!created) {
        throw new Error("Impossible de créer le salon.");
      }

      const { error } = await supabase
        .from("room_players")
        .upsert(
          {
            room_id: created.id,
            user_id: userId
          },
          {
            onConflict: "room_id,user_id"
          }
        );

      if (error) throw error;

      setRoom(created);
      setCode(created.code);
    } catch (e) {
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function joinRoom() {
    if (!userId || !pseudo.trim()) {
      setMessage("Enregistre un pseudo avant de jouer.");
      return;
    }

    setBusy(true);
    setMessage("");

    try {
      const { data, error } = await supabase
        .from("rooms")
        .select("*")
        .eq("code", code.trim().toUpperCase())
        .maybeSingle();

      if (error) throw error;
      if (!data) throw new Error("Salon introuvable.");

      if (data.status !== "waiting") {
        throw new Error("Cette partie a déjà commencé.");
      }

      const { error: joinError } = await supabase
        .from("room_players")
        .upsert(
          {
            room_id: data.id,
            user_id: userId
          },
          {
            onConflict: "room_id,user_id"
          }
        );

      if (joinError) throw joinError;

      setRoom(data);
      setMessage("");
    } catch (e) {
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  }

  // STATISTIQUES GLOBALES

  useEffect(() => {
    if (!userId) {
      setStats([]);
      return;
    }

    let active = true;

    async function loadStats() {
      const { data: completed } = await supabase
        .from("rooms")
        .select("id")
        .eq("status", "finished");

      const roomIds = (completed || []).map(r => r.id);

      if (!roomIds.length) {
        if (active) setStats([]);
        return;
      }

      const { data: participations } = await supabase
        .from("room_players")
        .select("room_id,user_id,score")
        .in("room_id", roomIds);

      const entries = participations || [];
      const ids = [...new Set(entries.map(p => p.user_id))];

      if (!ids.length) {
        if (active) setStats([]);
        return;
      }

      const { data: profiles } = await supabase
        .from("profiles")
        .select("id,username")
        .in("id", ids);

      const table = {};

      entries.forEach(p => {
        if (!table[p.user_id]) {
          table[p.user_id] = {
            id: p.user_id,
            username:
              profiles?.find(x => x.id === p.user_id)?.username ||
              "Joueur",
            games: 0,
            wins: 0,
            points: 0
          };
        }

        table[p.user_id].games++;
        table[p.user_id].points += p.score;
      });

      for (const roomId of roomIds) {
        const members = entries.filter(p => p.room_id === roomId);

        if (!members.length) continue;

        const best = Math.max(...members.map(p => p.score));

        members
          .filter(p => p.score === best)
          .forEach(p => {
            table[p.user_id].wins++;
          });
      }

      if (active) {
        setStats(
          Object.values(table).sort(
            (a, b) => b.points - a.points
          )
        );
      }
    }

    loadStats();

    const interval = setInterval(loadStats, 10000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [userId]);

  // SYNCHRONISATION DU SALON ET DU CHAT

  useEffect(() => {
    if (!room?.id) {
      setPlayers([]);
      setChat([]);
      return;
    }

    let active = true;
    const roomId = room.id;

    async function refresh() {
      const [roomRes, playerRes, chatRes] =
        await Promise.all([
          supabase
            .from("rooms")
            .select("*")
            .eq("id", roomId)
            .maybeSingle(),

          supabase
            .from("room_players")
            .select("user_id,score")
            .eq("room_id", roomId),

          supabase
            .from("chat_messages")
            .select("id,user_id,content,created_at")
            .eq("room_id", roomId)
            .order("created_at", { ascending: false })
            .limit(50)
        ]);

      if (!active) return;

      if (roomRes.data) {
        setRoom(old =>
          old?.id === roomId ? roomRes.data : old
        );
      }

      const entries = playerRes.data || [];
      const ids = [...new Set(entries.map(p => p.user_id))];

      let profiles = [];

      if (ids.length) {
        const response = await supabase
          .from("profiles")
          .select("id,username")
          .in("id", ids);

        profiles = response.data || [];
      }

      if (!active) return;

      const nameOf = id =>
        profiles.find(p => p.id === id)?.username || "Joueur";

      setPlayers(
        entries
          .map(p => ({
            ...p,
            username: nameOf(p.user_id)
          }))
          .sort((a, b) => b.score - a.score)
      );

      setChat(
        (chatRes.data || [])
          .map(m => ({
            ...m,
            username: nameOf(m.user_id)
          }))
          .reverse()
      );
    }

    refresh();

    const interval = setInterval(refresh, 1500);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [room?.id]);

  // RÉPONSES DU JOUEUR

  useEffect(() => {
    if (!room?.id || !playing || !userId) {
      setAnswersReady(false);
      return;
    }

    let active = true;

    setAnswersReady(false);
    setAnswers({});

    supabase
      .from("game_answers")
      .select("category,answer")
      .eq("room_id", room.id)
      .eq("round_number", room.round_number)
      .eq("user_id", userId)
      .then(({ data }) => {
        if (!active) return;

        const restored = {};

        (data || []).forEach(a => {
          restored[a.category] = a.answer;
        });

        setAnswers(restored);
        setAnswersReady(true);
      });

    return () => {
      active = false;
    };
  }, [room?.id, room?.round_number, playing, userId]);

  // SAUVEGARDE AUTOMATIQUE DES RÉPONSES

  useEffect(() => {
    if (
      !playing ||
      !answersReady ||
      !room?.id ||
      !userId ||
      categories.length !== 6
    ) {
      return;
    }

    const currentRoom = room.id;
    const currentRound = room.round_number;
    const currentAnswers = { ...answers };
    const currentCategories = [...categories];

    const timer = setTimeout(async () => {
      const rows = currentCategories.map(category => ({
        room_id: currentRoom,
        round_number: currentRound,
        user_id: userId,
        category,
        answer: (currentAnswers[category] || "").slice(0, 100)
      }));

      const { error } = await supabase
        .from("game_answers")
        .upsert(rows, {
          onConflict:
            "room_id,round_number,user_id,category"
        });

      if (error) {
        console.warn("Sauvegarde :", error.message);
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [
    answers,
    answersReady,
    playing,
    room?.id,
    room?.round_number,
    userId
  ]);

  // ANIMATION DE LA LETTRE

  useEffect(() => {
    if (!playing || !room?.id) {
      setSpinning(false);
      return;
    }

    setSpinning(true);

    let ticks = 0;

    const interval = setInterval(() => {
      ticks++;

      setFakeLetter(
        LETTERS[Math.floor(Math.random() * LETTERS.length)]
      );

      if (ticks >= 16) {
        clearInterval(interval);
        setSpinning(false);
      }
    }, 90);

    return () => clearInterval(interval);
  }, [room?.id, room?.round_number, playing]);

  // RÉSULTATS ET VOTES

  useEffect(() => {
    if (!room?.id || (!reviewing && !finished)) {
      setResults([]);
      setVotes([]);
      return;
    }

    let active = true;
    const roomId = room.id;
    const round = room.round_number;

    async function refreshReview() {
      const { data: answerRows } = await supabase
        .from("game_answers")
        .select("id,user_id,category,answer,points")
        .eq("room_id", roomId)
        .eq("round_number", round);

      if (!active) return;

      const rows = answerRows || [];
      setResults(rows);

      const ids = rows.map(r => r.id);

      if (!ids.length) {
        setVotes([]);
        return;
      }

      const { data: voteRows } = await supabase
        .from("answer_votes")
        .select("answer_id,voter_id,is_valid")
        .in("answer_id", ids);

      if (active) {
        setVotes(voteRows || []);
      }
    }

    refreshReview();

    const interval = setInterval(refreshReview, 1500);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [
    room?.id,
    room?.round_number,
    reviewing,
    finished
  ]);

  // FONCTIONS DE JEU

  async function runAction(name, params) {
    setBusy(true);
    setMessage("");

    try {
      const { data, error } = await supabase.rpc(
        name,
        params
      );

      if (error) throw error;

      if (data) setRoom(data);
    } catch (e) {
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  }

  function startGame() {
    if (!isHost || players.length < 2) return;

    runAction("pb_start_game", {
      p_room_id: room.id
    });
  }

  function stopRound() {
    if (!allFilled || busy || spinning) return;

    runAction("pb_stop_round", {
      p_room_id: room.id,
      p_answers: answers
    });
  }

  async function vote(answerId, valid) {
    setMessage("");

    try {
      const { error } = await supabase.rpc(
        "pb_vote_answer",
        {
          p_answer_id: answerId,
          p_valid: valid
        }
      );

      if (error) throw error;

      setVotes(previous => [
        ...previous.filter(v =>
          !(
            v.answer_id === answerId &&
            v.voter_id === userId
          )
        ),
        {
          answer_id: answerId,
          voter_id: userId,
          is_valid: valid
        }
      ]);
    } catch (e) {
      setMessage(e.message);
    }
  }

  function finalizeReview() {
    if (!isHost) return;

    runAction("pb_finalize_review", {
      p_room_id: room.id
    });
  }

  function nextRound() {
    if (!isHost) return;

    runAction("pb_next_round", {
      p_room_id: room.id
    });
  }

  function finishGame() {
    if (!isHost) return;

    runAction("pb_finish_game", {
      p_room_id: room.id
    });
  }

  // CHAT

  async function sendChat(e) {
    e.preventDefault();

    const content = chatInput.trim();

    if (!content || !room?.id || !userId) return;

    setChatInput("");

    const { error } = await supabase
      .from("chat_messages")
      .insert({
        room_id: room.id,
        user_id: userId,
        content: content.slice(0, 300)
      });

    if (error) {
      setChatInput(content);
      setMessage(error.message);
    }
  }

  async function signOut() {
    setRoom(null);
    setMessage("");

    const { error } = await supabase.auth.signOut();

    if (error) setMessage(error.message);
  }

  const toVote = results.filter(a =>
    a.user_id !== userId &&
    (a.answer || "").trim()
  );

  const myVoteCount = toVote.filter(a =>
    votes.some(v =>
      v.answer_id === a.id &&
      v.voter_id === userId
    )
  ).length;

  const requiredVotes =
    results.filter(a => (a.answer || "").trim()).length *
    Math.max(players.length - 1, 0);

  const totalVotes = votes.length;

  // CHARGEMENT

  if (loading) {
    return (
      <main className="container">
        <p>Chargement...</p>
      </main>
    );
  }

  // PAGE DE CONNEXION

  if (!session) {
    return (
      <main className="container">
        <header>
          <span className="logo">PETIT BAC</span>
          <span className="tag">EN LIGNE</span>
        </header>

        <section className="welcome">
          <p className="subtitle">BIENVENUE</p>

          <h1>Prêt à jouer ?</h1>

          <p className="description">
            Connecte-toi pour rejoindre tes amis.
          </p>

          <label htmlFor="email">Adresse e-mail</label>

          <input
            id="email"
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="ton@email.com"
          />

          <label htmlFor="password">Mot de passe</label>

          <input
            id="password"
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Minimum 6 caractères"
          />

          <div className="buttons">
            <button
              disabled={busy}
              onClick={() => handleAuth("signin")}
            >
              Se connecter
            </button>

            <button
              className="secondary"
              disabled={busy}
              onClick={() => handleAuth("signup")}
            >
              Créer un compte
            </button>
          </div>

          <p role="status">{message}</p>
        </section>
      </main>
    );
  }

  // APPLICATION CONNECTÉE

  return (
    <main className="container">
      <header>
        <span className="logo">PETIT BAC</span>

        <button
          className="secondary"
          onClick={signOut}
        >
          Déconnexion
        </button>
      </header>

      {!room ? (
        <section className="welcome">
          <p className="subtitle">MON ESPACE</p>

          <h1>Bienvenue !</h1>

          <label htmlFor="pseudo">Ton pseudo</label>

          <input
            id="pseudo"
            value={pseudo}
            onChange={e => setPseudo(e.target.value)}
            placeholder="Choisis ton pseudo"
          />

          <button
            style={fullButton}
            disabled={busy}
            onClick={savePseudo}
          >
            Enregistrer mon pseudo
          </button>

          <div className="buttons">
            <button
              disabled={busy}
              onClick={createRoom}
            >
              Créer une partie
            </button>

            <div className="join">
              <input
                aria-label="Code du salon"
                value={code}
                onChange={e =>
                  setCode(e.target.value.toUpperCase())
                }
                placeholder="Code du salon"
                maxLength={6}
              />

              <button
                className="secondary"
                disabled={busy}
                onClick={joinRoom}
              >
                Rejoindre
              </button>
            </div>
          </div>

          {/* STATISTIQUES PERSONNELLES */}

          <div style={panel}>
            <h2>Mes statistiques</h2>

            {(() => {
              const mine = stats.find(s => s.id === userId);

              return (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(3, 1fr)",
                    gap: 12,
                    textAlign: "center"
                  }}
                >
                  {[
                    ["Parties", mine?.games || 0],
                    ["Victoires", mine?.wins || 0],
                    ["Points", mine?.points || 0]
                  ].map(([label, value]) => (
                    <div key={label}>
                      <strong style={{ fontSize: 26 }}>
                        {value}
                      </strong>
                      <p>{label}</p>
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>

          {/* CLASSEMENT GLOBAL */}

          <div style={panel}>
            <h2>🏆 Classement général</h2>

            <p className="description">
              Classement des parties terminées.
            </p>

            {stats.length === 0 && (
              <p>
                Aucune partie terminée pour le moment.
              </p>
            )}

            {stats.slice(0, 20).map((player, index) => (
              <div
                key={player.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 12,
                  padding: "10px 0",
                  borderBottom: "1px solid #eee"
                }}
              >
                <span>
                  {index + 1}. {player.username}
                  {player.id === userId ? " (toi)" : ""}
                </span>

                <strong>
                  {player.points} pts
                </strong>
              </div>
            ))}
          </div>

          <p role="status">{message}</p>
        </section>
      ) : (
        <section className="welcome">
          <p className="subtitle">
            {finished
              ? "PARTIE TERMINÉE"
              : playing || reviewing
              ? `MANCHE ${room.round_number}`
              : "SALON PRIVÉ"}
          </p>

          <h1>
            {finished
              ? "Résultats finaux"
              : `Salon ${room.code}`}
          </h1>

          <div className="buttons">
            <button
              className="secondary"
              onClick={() =>
                navigator.clipboard
                  .writeText(room.code)
                  .then(() =>
                    setMessage("Code copié !")
                  )
                  .catch(() =>
                    setMessage("Copie le code.")
                  )
              }
            >
              Copier le code
            </button>

            <button
              className="secondary"
              onClick={() => {
                setRoom(null);
                setMessage("");
              }}
            >
              Retour à l'accueil
            </button>
          </div>

          {/* JOUEURS ET CLASSEMENT */}

          <div style={panel}>
            <h3>
              {room.status === "waiting"
                ? `Joueurs (${players.length})`
                : "Classement de la partie"}
            </h3>

            {players.map((p, i) => (
              <div
                key={p.user_id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 12,
                  padding: "9px 0",
                  borderBottom: "1px solid #eee"
                }}
              >
                <span>
                  {i + 1}. {p.username}
                  {p.user_id === room.host_id
                    ? " 👑"
                    : ""}
                  {p.user_id === userId
                    ? " (toi)"
                    : ""}
                </span>

                <strong>
                  {p.score} pts
                </strong>
              </div>
            ))}
          </div>

          {/* SALLE D'ATTENTE */}

          {room.status === "waiting" && (
            <div style={panel}>
              <h2>En attente des joueurs</h2>

              <p>
                Partage le code{" "}
                <strong>{room.code}</strong>.
              </p>

              {isHost ? (
                <button
                  style={fullButton}
                  disabled={busy || players.length < 2}
                  onClick={startGame}
                >
                  Lancer la partie
                </button>
              ) : (
                <p>
                  En attente du lancement par l'hôte...
                </p>
              )}
            </div>
          )}

          {/* MANCHE EN COURS */}

          {playing && (
            <div style={panel}>
              <h2>
                Manche {room.round_number}
              </h2>

              {spinning ? (
                <div
                  style={{
                    fontSize: 80,
                    fontWeight: 900,
                    textAlign: "center",
                    padding: 35
                  }}
                >
                  {fakeLetter}
                </div>
              ) : (
                <>
                  <p style={{ textAlign: "center" }}>
                    LETTRE À UTILISER
                  </p>

                  <div
                    style={{
                      fontSize: 80,
                      fontWeight: 900,
                      textAlign: "center"
                    }}
                  >
                    {room.letter}
                  </div>

                  <p style={{ textAlign: "center" }}>
                    Remplis les six catégories.
                  </p>

                  {categories.map(category => (
                    <div key={category}>
                      <label
                        htmlFor={`answer-${category}`}
                      >
                        {category}
                      </label>

                      <input
                        id={`answer-${category}`}
                        style={field}
                        maxLength={100}
                        disabled={!answersReady || busy}
                        value={answers[category] || ""}
                        onChange={e =>
                          setAnswers(old => ({
                            ...old,
                            [category]: e.target.value
                          }))
                        }
                        placeholder={`Mot en ${room.letter}`}
                      />
                    </div>
                  ))}

                  <button
                    style={fullButton}
                    disabled={
                      !allFilled ||
                      !answersReady ||
                      busy
                    }
                    onClick={stopRound}
                  >
                    STOP !
                  </button>

                  <p style={{ textAlign: "center" }}>
                    Le premier à remplir ses six cases
                    peut arrêter la manche.
                  </p>
                </>
              )}
            </div>
          )}

          {/* VALIDATION DES RÉPONSES */}

          {(reviewing || finished) && (
            <div style={panel}>
              <h2>
                Validation — manche{" "}
                {room.round_number}
              </h2>

              {!finalized && reviewing && (
                <p>
                  Vote pour accepter ou refuser les
                  réponses des autres joueurs.
                  <strong>
                    {" "}
                    {myVoteCount}/{toVote.length}
                    {" "}votes effectués.
                  </strong>
                </p>
              )}

              {categories.map(category => (
                <div
                  key={category}
                  style={{
                    borderBottom: "1px solid #ddd",
                    padding: "14px 0"
                  }}
                >
                  <h3>{category}</h3>

                  {players.map(player => {
                    const answer = results.find(a =>
                      a.user_id === player.user_id &&
                      a.category === category
                    );

                    const ownVote = votes.find(v =>
                      v.answer_id === answer?.id &&
                      v.voter_id === userId
                    );

                    return (
                      <div
                        key={player.user_id}
                        style={{
                          padding: "8px 0"
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            justifyContent:
                              "space-between",
                            gap: 12
                          }}
                        >
                          <span>
                            <strong>
                              {player.username}
                            </strong>
                            {" : "}
                            {answer?.answer || "—"}
                          </span>

                          {finalized && (
                            <strong>
                              +{answer?.points || 0}
                            </strong>
                          )}
                        </div>

                        {reviewing &&
                          !finalized &&
                          answer?.id &&
                          answer.answer.trim() &&
                          player.user_id !== userId && (
                            <div
                              style={{
                                display: "flex",
                                gap: 10,
                                marginTop: 8
                              }}
                            >
                              <button
                                className={
                                  ownVote?.is_valid === true
                                    ? ""
                                    : "secondary"
                                }
                                onClick={() =>
                                  vote(answer.id, true)
                                }
                              >
                                ✓ Valide
                              </button>

                              <button
                                className={
                                  ownVote?.is_valid === false
                                    ? ""
                                    : "secondary"
                                }
                                onClick={() =>
                                  vote(answer.id, false)
                                }
                              >
                                ✕ Refusé
                              </button>
                            </div>
                          )}
                      </div>
                    );
                  })}
                </div>
              ))}

              {reviewing && isHost && !finalized && (
                <>
                  <p>
                    Votes reçus :{" "}
                    {totalVotes}/{requiredVotes}
                  </p>

                  <button
                    style={fullButton}
                    disabled={
                      busy ||
                      totalVotes < requiredVotes ||
                      results.length === 0
                    }
                    onClick={finalizeReview}
                  >
                    Valider les résultats
                  </button>
                </>
              )}

              {reviewing &&
                !isHost &&
                !finalized && (
                  <p>
                    En attente de la validation
                    par l'hôte...
                  </p>
                )}

              {reviewing &&
                finalized &&
                isHost && (
                  <>
                    <button
                      style={fullButton}
                      disabled={busy}
                      onClick={nextRound}
                    >
                      Manche suivante
                    </button>

                    <button
                      className="secondary"
                      style={fullButton}
                      disabled={busy}
                      onClick={finishGame}
                    >
                      Terminer la partie
                    </button>
                  </>
                )}

              {reviewing &&
                finalized &&
                !isHost && (
                  <p>
                    Résultats validés !
                    En attente de l'hôte.
                  </p>
                )}

              {finished && (
                <div
                  style={{
                    textAlign: "center"
                  }}
                >
                  <h2>
                    🏆 Partie terminée !
                  </h2>

                  {players.length > 0 && (
                    <p>
                      Vainqueur :{" "}
                      <strong>
                        {players
                          .filter(p =>
                            p.score === players[0].score
                          )
                          .map(p => p.username)
                          .join(" et ")}
                      </strong>
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* CHAT DU SALON */}

          <div style={panel}>
            <h2>💬 Chat du salon</h2>

            <div
              style={{
                height: 220,
                overflowY: "auto",
                padding: 12,
                border: "1px solid #eee",
                borderRadius: 8,
                background: "#fafafa"
              }}
            >
              {chat.length === 0 && (
                <p>
                  Aucun message pour le moment.
                </p>
              )}

              {chat.map(m => (
                <p
                  key={m.id}
                  style={{
                    margin: "7px 0",
                    overflowWrap: "anywhere"
                  }}
                >
                  <strong>
                    {m.username} :
                  </strong>{" "}
                  {m.content}
                </p>
              ))}
            </div>

            <form
              onSubmit={sendChat}
              style={{
                display: "flex",
                gap: 10,
                marginTop: 12
              }}
            >
              <input
                aria-label="Message du chat"
                value={chatInput}
                onChange={e =>
                  setChatInput(e.target.value)
                }
                maxLength={300}
                placeholder="Écris un message..."
                style={{
                  flex: 1,
                  minWidth: 0,
                  margin: 0
                }}
              />

              <button
                type="submit"
                disabled={!chatInput.trim()}
              >
                Envoyer
              </button>
            </form>
          </div>

          <p role="status">{message}</p>
        </section>
      )}
    </main>
  );
}
