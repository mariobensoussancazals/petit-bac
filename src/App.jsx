
import React, { useEffect, useState } from 'react';
import { supabase } from './supabase';

const CATEGORIES = [
  'Prénom', 'Animal', 'Pays', 'Ville',
  'Métier', 'Objet', 'Aliment', 'Sport',
  'Célébrité', 'Film', 'Série', 'Marque',
  'Vêtement', 'Plante', 'Instrument',
  'Personnage fictif', 'Jeu vidéo',
  'Moyen de transport', 'Boisson',
  'Livre', 'Couleur', 'Fruit',
  'Légume', 'Équipe sportive'
];

const LETTERS = 'ABCDEFGHIJKLMNOPRSTUV';

function randomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const values = new Uint32Array(6);
  crypto.getRandomValues(values);
  return Array.from(values, n => chars[n % chars.length]).join('');
}

export default function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pseudo, setPseudo] = useState('');
  const [code, setCode] = useState('');
  const [room, setRoom] = useState(null);
  const [players, setPlayers] = useState([]);
  const [answers, setAnswers] = useState({});
  const [answersReady, setAnswersReady] = useState(false);
  const [results, setResults] = useState([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [spinning, setSpinning] = useState(false);
  const [fakeLetter, setFakeLetter] = useState('A');
  const [fakeCategory, setFakeCategory] = useState('Animal');

  const userId = session?.user?.id;
  const isHost = !!room && room.host_id === userId;
  const categories = room?.categories || [];
  const playing = room?.status === 'playing';
  const reviewing = room?.status === 'review';
  const finished = room?.status === 'finished';

  const allFilled = categories.length === 6 &&
    categories.every(c => (answers[c] || '').trim().length > 0);

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
      setPseudo('');
      setRoom(null);
      return;
    }

    let active = true;

    supabase
      .from('profiles')
      .select('username')
      .eq('id', userId)
      .maybeSingle()
      .then(({ data }) => {
        if (active) setPseudo(data?.username || '');
      });

    return () => {
      active = false;
    };
  }, [userId]);

  async function handleAuth(action) {
    if (!email.trim() || !password) {
      setMessage('Entre ton e-mail et ton mot de passe.');
      return;
    }

    setBusy(true);
    setMessage('');

    try {
      const { error } = action === 'signup'
        ? await supabase.auth.signUp({
            email: email.trim(),
            password
          })
        : await supabase.auth.signInWithPassword({
            email: email.trim(),
            password
          });

      if (error) throw error;

      if (action === 'signup') {
        setMessage(
          'Compte créé ! Confirme ton e-mail si nécessaire.'
        );
      }
    } catch (e) {
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function savePseudo() {
    if (!userId || !pseudo.trim()) {
      setMessage('Choisis un pseudo.');
      return;
    }

    setBusy(true);
    setMessage('');

    try {
      const { error } = await supabase
        .from('profiles')
        .upsert({
          id: userId,
          username: pseudo.trim()
        });

      if (error) throw error;
      setMessage('Pseudo enregistré !');
    } catch (e) {
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function createRoom() {
    if (!userId || !pseudo.trim()) {
      setMessage('Connecte-toi et enregistre un pseudo.');
      return;
    }

    setBusy(true);
    setMessage('');

    try {
      let created = null;

      for (let i = 0; i < 5; i++) {
        const { data, error } = await supabase
          .from('rooms')
          .insert({
            code: randomCode(),
            host_id: userId,
            status: 'waiting'
          })
          .select()
          .single();

        if (!error) {
          created = data;
          break;
        }

        if (error.code !== '23505') throw error;
      }

      if (!created) {
        throw new Error('Impossible de créer le salon.');
      }

      const { error } = await supabase
        .from('room_players')
        .upsert({
          room_id: created.id,
          user_id: userId
        }, {
          onConflict: 'room_id,user_id'
        });

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
      setMessage('Enregistre un pseudo avant de jouer.');
      return;
    }

    setBusy(true);
    setMessage('');

    try {
      const { data, error } = await supabase
        .from('rooms')
        .select('*')
        .eq('code', code.trim().toUpperCase())
        .maybeSingle();

      if (error) throw error;
      if (!data) throw new Error('Salon introuvable.');

      if (data.status !== 'waiting') {
        throw new Error('Cette partie a déjà commencé.');
      }

      const { error: joinError } = await supabase
        .from('room_players')
        .upsert({
          room_id: data.id,
          user_id: userId
        }, {
          onConflict: 'room_id,user_id'
        });

      if (joinError) throw joinError;

      setRoom(data);
      setMessage('');
    } catch (e) {
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  }

  // SYNCHRONISATION DES SALONS
  useEffect(() => {
    if (!room?.id) {
      setPlayers([]);
      setResults([]);
      return;
    }

    let active = true;
    const roomId = room.id;

    async function refresh() {
      const [roomResponse, playerResponse] =
        await Promise.all([
          supabase
            .from('rooms')
            .select('*')
            .eq('id', roomId)
            .maybeSingle(),
          supabase
            .from('room_players')
            .select('user_id,score')
            .eq('room_id', roomId)
        ]);

      if (!active) return;

      if (roomResponse.data) {
        setRoom(previous => {
          if (!previous || previous.id !== roomId) {
            return previous;
          }
          return roomResponse.data;
        });
      }

      if (playerResponse.error) return;

      const entries = playerResponse.data || [];
      const ids = entries.map(p => p.user_id);

      let profiles = [];

      if (ids.length) {
        const response = await supabase
          .from('profiles')
          .select('id,username')
          .in('id', ids);

        profiles = response.data || [];
      }

      if (!active) return;

      setPlayers(
        entries.map(p => ({
          ...p,
          username:
            profiles.find(x => x.id === p.user_id)
              ?.username || 'Joueur'
        })).sort((a, b) => b.score - a.score)
      );
    }

    refresh();
    const interval = setInterval(refresh, 1500);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [room?.id]);

  // RÉCUPÉRER LES RÉPONSES À CHAQUE MANCHE
  useEffect(() => {
    if (!room?.id || !playing || !userId) {
      setAnswersReady(false);
      return;
    }

    let active = true;

    setAnswersReady(false);
    setAnswers({});

    async function restore() {
      const { data } = await supabase
        .from('game_answers')
        .select('category,answer')
        .eq('room_id', room.id)
        .eq('round_number', room.round_number)
        .eq('user_id', userId);

      if (!active) return;

      const restored = {};
      (data || []).forEach(a => {
        restored[a.category] = a.answer;
      });

      setAnswers(restored);
      setAnswersReady(true);
    }

    restore();

    return () => {
      active = false;
    };
  }, [room?.id, room?.round_number, playing, userId]);

  // SAUVEGARDE AUTOMATIQUE DES RÉPONSES
  useEffect(() => {
    if (
      !room?.id ||
      !playing ||
      !answersReady ||
      !userId ||
      categories.length !== 6
    ) return;

    const roomId = room.id;
    const roundNumber = room.round_number;
    const currentAnswers = { ...answers };
    const currentCategories = [...categories];

    const timer = setTimeout(async () => {
      const rows = currentCategories.map(category => ({
        room_id: roomId,
        round_number: roundNumber,
        user_id: userId,
        category,
        answer: (currentAnswers[category] || '').slice(0, 100)
      }));

      const { error } = await supabase
        .from('game_answers')
        .upsert(rows, {
          onConflict:
            'room_id,round_number,user_id,category'
        });

      if (error) {
        console.warn('Sauvegarde des réponses :', error.message);
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

  // ROULETTE VISUELLE DES CATÉGORIES ET LETTRES
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

      setFakeCategory(
        CATEGORIES[Math.floor(Math.random() * CATEGORIES.length)]
      );

      if (ticks >= 16) {
        clearInterval(interval);
        setSpinning(false);
      }
    }, 90);

    return () => clearInterval(interval);
  }, [room?.id, room?.round_number, playing]);

  // RÉSULTATS APRÈS STOP
  useEffect(() => {
    if (!room?.id || (!reviewing && !finished)) {
      setResults([]);
      return;
    }

    let active = true;

    async function loadResults() {
      const { data, error } = await supabase
        .from('game_answers')
        .select('user_id,category,answer,points')
        .eq('room_id', room.id)
        .eq('round_number', room.round_number);

      if (active && !error) {
        setResults(data || []);
      }
    }

    loadResults();

    const interval = setInterval(loadResults, 1500);

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

  // APPELS DES FONCTIONS SÉCURISÉES SUPABASE
  async function runAction(functionName, params) {
    setBusy(true);
    setMessage('');

    try {
      const { data, error } = await supabase.rpc(
        functionName,
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

    runAction('pb_start_game', {
      p_room_id: room.id
    });
  }

  function stopRound() {
    if (!allFilled || busy || spinning) return;

    runAction('pb_stop_round', {
      p_room_id: room.id,
      p_answers: answers
    });
  }

  function nextRound() {
    if (!isHost) return;

    runAction('pb_next_round', {
      p_room_id: room.id
    });
  }

  function finishGame() {
    if (!isHost) return;

    runAction('pb_finish_game', {
      p_room_id: room.id
    });
  }

  async function signOut() {
    setRoom(null);
    setMessage('');

    const { error } = await supabase.auth.signOut();

    if (error) setMessage(error.message);
  }

  // STYLES LOCAUX
  const panel = {
    marginTop: 24,
    padding: 22,
    border: '1px solid #ddd',
    borderRadius: 12,
    textAlign: 'left'
  };

  const bigLetter = {
    fontSize: 80,
    fontWeight: 900,
    textAlign: 'center',
    margin: '16px 0'
  };

  const inputStyle = {
    width: '100%',
    boxSizing: 'border-box',
    marginTop: 8,
    marginBottom: 15
  };

  const actionButton = {
    width: '100%',
    marginTop: 14
  };

  // CHARGEMENT
  if (loading) {
    return (
      <main className="container">
        <p>Chargement...</p>
      </main>
    );
  }

  // CONNEXION
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
            Connecte-toi pour jouer avec tes amis.
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
              onClick={() => handleAuth('signin')}
            >
              Se connecter
            </button>

            <button
              className="secondary"
              disabled={busy}
              onClick={() => handleAuth('signup')}
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

          <p className="description">
            Crée une partie ou rejoins tes amis.
          </p>

          <label htmlFor="pseudo">Ton pseudo</label>
          <input
            id="pseudo"
            value={pseudo}
            onChange={e => setPseudo(e.target.value)}
            placeholder="Choisis ton pseudo"
          />

          <div className="buttons">
            <button disabled={busy} onClick={savePseudo}>
              Enregistrer mon pseudo
            </button>
          </div>

          <div className="buttons">
            <button disabled={busy} onClick={createRoom}>
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

          <p role="status">{message}</p>
        </section>
      ) : (
        <section className="welcome">
          <p className="subtitle">
            {finished
              ? 'PARTIE TERMINÉE'
              : playing || reviewing
              ? `MANCHE ${room.round_number}`
              : 'SALON PRIVÉ'}
          </p>

          <h1>
            {finished
              ? 'Résultats finaux'
              : `Salon ${room.code}`}
          </h1>

          <div className="buttons">
            <button
              className="secondary"
              onClick={() =>
                navigator.clipboard
                  .writeText(room.code)
                  .then(() => setMessage('Code copié !'))
                  .catch(() => setMessage('Copie le code.'))
              }
            >
              Copier le code
            </button>

            <button
              className="secondary"
              onClick={() => {
                setRoom(null);
                setMessage('');
              }}
            >
              Retour à l'accueil
            </button>
          </div>

          {/* CLASSEMENT */}
          <div style={panel}>
            <h3>
              {playing || reviewing || finished
                ? 'Classement général'
                : `Joueurs (${players.length})`}
            </h3>

            {players.map((player, index) => (
              <div
                key={player.user_id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 12,
                  padding: '9px 0',
                  borderBottom: '1px solid #eee'
                }}
              >
                <span>
                  {index + 1}. {player.username}
                  {player.user_id === room.host_id
                    ? ' 👑'
                    : ''}
                  {player.user_id === userId
                    ? ' (toi)'
                    : ''}
                </span>

                <strong>{player.score} pts</strong>
              </div>
            ))}
          </div>

          {/* SALLE D'ATTENTE */}
          {room.status === 'waiting' && (
            <div style={panel}>
              <h2>En attente des joueurs</h2>

              <p>
                Partage le code <strong>{room.code}</strong>
                {' '}avec tes amis.
              </p>

              {isHost ? (
                <>
                  <button
                    style={actionButton}
                    disabled={busy || players.length < 2}
                    onClick={startGame}
                  >
                    Lancer la partie
                  </button>

                  {players.length < 2 && (
                    <p>
                      Il faut au moins 2 joueurs.
                    </p>
                  )}
                </>
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
                <>
                  <p style={{ textAlign: 'center' }}>
                    Tirage des catégories et de la lettre...
                  </p>

                  <div style={bigLetter}>
                    {fakeLetter}
                  </div>

                  <p style={{ textAlign: 'center' }}>
                    {fakeCategory}
                  </p>
                </>
              ) : (
                <>
                  <p style={{ textAlign: 'center' }}>
                    LETTRE À UTILISER
                  </p>

                  <div style={bigLetter}>
                    {room.letter}
                  </div>

                  <p style={{ textAlign: 'center' }}>
                    Remplis les six catégories.
                    Le premier à terminer peut arrêter la manche.
                  </p>

                  {categories.map(category => (
                    <div key={category}>
                      <label htmlFor={`answer-${category}`}>
                        {category}
                      </label>

                      <input
                        id={`answer-${category}`}
                        style={inputStyle}
                        disabled={!answersReady || busy}
                        maxLength={100}
                        value={answers[category] || ''}
                        onChange={e => {
                          const value = e.target.value;
                          setAnswers(previous => ({
                            ...previous,
                            [category]: value
                          }));
                        }}
                        placeholder={
                          `Mot commençant par ${room.letter}`
                        }
                      />
                    </div>
                  ))}

                  <button
                    style={actionButton}
                    disabled={
                      !answersReady ||
                      !allFilled ||
                      busy
                    }
                    onClick={stopRound}
                  >
                    {busy
                      ? 'Arrêt en cours...'
                      : 'STOP !'}
                  </button>

                  {!allFilled && (
                    <p style={{
                      textAlign: 'center',
                      color: '#777'
                    }}>
                      Remplis les 6 cases pour activer STOP.
                    </p>
                  )}
                </>
              )}
            </div>
          )}

          {/* RÉSULTATS DE LA MANCHE */}
          {(reviewing || finished) && (
            <div style={panel}>
              <h2>
                Résultats de la manche {room.round_number}
              </h2>

              <p>
                Les points sont calculés automatiquement.
              </p>

              {categories.map(category => (
                <div
                  key={category}
                  style={{
                    borderBottom: '1px solid #ddd',
                    padding: '12px 0'
                  }}
                >
                  <h3>{category}</h3>

                  {players.map(player => {
                    const answer = results.find(
                      a =>
                        a.user_id === player.user_id &&
                        a.category === category
                    );

                    return (
                      <div
                        key={player.user_id}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          gap: 12,
                          marginTop: 8
                        }}
                      >
                        <span>
                          <strong>{player.username}</strong>
                          {' : '}
                          {answer?.answer || '—'}
                        </span>

                        <strong>
                          +{answer?.points || 0}
                        </strong>
                      </div>
                    );
                  })}
                </div>
              ))}

              {reviewing && isHost && (
                <>
                  <button
                    style={actionButton}
                    disabled={busy}
                    onClick={nextRound}
                  >
                    Manche suivante
                  </button>

                  <button
                    className="secondary"
                    style={actionButton}
                    disabled={busy}
                    onClick={finishGame}
                  >
                    Terminer la partie
                  </button>
                </>
              )}

              {reviewing && !isHost && (
                <p>
                  En attente de la prochaine manche...
                </p>
              )}

              {finished && (
                <div style={{ textAlign: 'center' }}>
                  <h2>🏆 Partie terminée !</h2>

                  {players.length > 0 && (
                    <p>
                      Vainqueur :{' '}
                      <strong>
                        {players
                          .filter(p =>
                            p.score === players[0].score
                          )
                          .map(p => p.username)
                          .join(' et ')}
                      </strong>
                    </p>
                  )}

                  <p>
                    Bravo à tous les participants !
                  </p>
                </div>
              )}
            </div>
          )}

          <p role="status">{message}</p>
        </section>
      )}
    </main>
  );
}
