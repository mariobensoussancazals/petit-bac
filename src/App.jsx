
import React, { useEffect, useState } from 'react';
import { supabase } from './supabase';

export default function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pseudo, setPseudo] = useState('');
  const [code, setCode] = useState('');
  const [room, setRoom] = useState(null);
  const [players, setPlayers] = useState([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  // Connexion et déconnexion
  useEffect(() => {
    let active = true;

    supabase.auth.getSession().then(({ data, error }) => {
      if (!active) return;
      if (error) setMessage(error.message);
      setSession(data?.session ?? null);
      setLoading(false);
    });

    const { data: listener } =
      supabase.auth.onAuthStateChange((_event, nextSession) => {
        setSession(nextSession);
      });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  // Récupérer le pseudo
  useEffect(() => {
    if (!session?.user?.id) {
      setPseudo('');
      setRoom(null);
      return;
    }

    let active = true;

    async function loadProfile() {
      const { data, error } = await supabase
        .from('profiles')
        .select('username')
        .eq('id', session.user.id)
        .maybeSingle();

      if (!active) return;

      if (error) {
        setMessage(error.message);
      } else {
        setPseudo(data?.username ?? '');
      }
    }

    loadProfile();

    return () => {
      active = false;
    };
  }, [session?.user?.id]);

  // Créer un compte ou se connecter
  async function handleAuth(action) {
    if (!email.trim() || !password) {
      setMessage('Renseigne ton e-mail et ton mot de passe.');
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
          'Compte créé ! Vérifie tes e-mails si une confirmation est demandée.'
        );
      }
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  // Enregistrer son pseudo
  async function savePseudo() {
    if (!session?.user) return;

    const username = pseudo.trim();

    if (!username) {
      setMessage('Choisis un pseudo.');
      return;
    }

    setBusy(true);
    setMessage('');

    try {
      const { error } = await supabase
        .from('profiles')
        .upsert({
          id: session.user.id,
          username
        });

      if (error) throw error;

      setPseudo(username);
      setMessage('Pseudo enregistré !');
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  // Générer un code de salon
  function generateCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const values = new Uint32Array(6);
    crypto.getRandomValues(values);

    return Array.from(
      values,
      value => chars[value % chars.length]
    ).join('');
  }

  // Créer un salon
  async function createRoom() {
    if (!session?.user) {
      setMessage('Tu dois être connecté.');
      return;
    }

    if (!pseudo.trim()) {
      setMessage('Enregistre un pseudo avant de jouer.');
      return;
    }

    setBusy(true);
    setMessage('');

    try {
      let created = null;

      for (let attempt = 0; attempt < 5; attempt++) {
        const roomCode = generateCode();

        const { data, error } = await supabase
          .from('rooms')
          .insert({
            code: roomCode,
            host_id: session.user.id,
            status: 'waiting'
          })
          .select()
          .single();

        if (!error) {
          created = data;
          break;
        }

        if (error.code !== '23505') {
          throw error;
        }
      }

      if (!created) {
        throw new Error(
          'Impossible de générer un code unique. Réessaie.'
        );
      }

      const { error: playerError } = await supabase
        .from('room_players')
        .upsert(
          {
            room_id: created.id,
            user_id: session.user.id
          },
          { onConflict: 'room_id,user_id' }
        );

      if (playerError) throw playerError;

      setRoom(created);
      setCode(created.code);
      setMessage('Salon créé avec succès !');
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  // Rejoindre un salon
  async function joinRoom() {
    if (!session?.user) {
      setMessage('Tu dois être connecté.');
      return;
    }

    if (!pseudo.trim()) {
      setMessage('Enregistre un pseudo avant de jouer.');
      return;
    }

    const roomCode = code.trim().toUpperCase();

    if (!roomCode) {
      setMessage('Entre un code de salon.');
      return;
    }

    setBusy(true);
    setMessage('');

    try {
      const { data, error } = await supabase
        .from('rooms')
        .select('*')
        .eq('code', roomCode)
        .maybeSingle();

      if (error) throw error;

      if (!data) {
        setMessage('Aucun salon trouvé avec ce code.');
        return;
      }

      if (data.status !== 'waiting') {
        setMessage(
          'Cette partie a déjà commencé ou est terminée.'
        );
        return;
      }

      const { error: playerError } = await supabase
        .from('room_players')
        .upsert(
          {
            room_id: data.id,
            user_id: session.user.id
          },
          { onConflict: 'room_id,user_id' }
        );

      if (playerError) throw playerError;

      setRoom(data);
      setCode(data.code);
      setMessage('Tu as rejoint le salon !');
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  // Charger les joueurs du salon
  async function loadPlayers(roomId) {
    const { data, error } = await supabase
      .from('room_players')
      .select('user_id')
      .eq('room_id', roomId);

    if (error) {
      setMessage(error.message);
      return;
    }

    const userIds = (data || []).map(
      player => player.user_id
    );

    if (userIds.length === 0) {
      setPlayers([]);
      return;
    }

    const { data: profiles, error: profileError } =
      await supabase
        .from('profiles')
        .select('id, username')
        .in('id', userIds);

    if (profileError) {
      setMessage(profileError.message);
      return;
    }

    setPlayers(
      userIds.map(id => ({
        id,
        username:
          profiles?.find(profile => profile.id === id)
            ?.username || 'Joueur'
      }))
    );
  }

  // Actualiser automatiquement les joueurs
  useEffect(() => {
    if (!room?.id) {
      setPlayers([]);
      return;
    }

    let active = true;

    async function refreshPlayers() {
      if (active) {
        await loadPlayers(room.id);
      }
    }

    refreshPlayers();

    const interval = setInterval(
      refreshPlayers,
      2000
    );

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [room?.id]);

  // Synchroniser le statut de la partie
  useEffect(() => {
    if (!room?.id) return;

    let active = true;
    const roomId = room.id;

    async function checkGameStatus() {
      const { data, error } = await supabase
        .from('rooms')
        .select('status')
        .eq('id', roomId)
        .maybeSingle();

      if (!active || error || !data) return;

      setRoom(previous => {
        if (!previous || previous.id !== roomId) {
          return previous;
        }

        if (previous.status === data.status) {
          return previous;
        }

        return {
          ...previous,
          status: data.status
        };
      });
    }

    checkGameStatus();

    const interval = setInterval(
      checkGameStatus,
      2000
    );

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [room?.id]);

  // Lancer la partie
  async function startGame() {
    if (!room || !session?.user) return;

    if (room.host_id !== session.user.id) {
      setMessage(
        "Seul l'hôte peut lancer la partie."
      );
      return;
    }

    if (players.length < 2) {
      setMessage(
        'Il faut au moins 2 joueurs pour commencer.'
      );
      return;
    }

    if (room.status !== 'waiting') {
      return;
    }

    setBusy(true);
    setMessage('');

    try {
      const { data, error } = await supabase
        .from('rooms')
        .update({
          status: 'playing'
        })
        .eq('id', room.id)
        .eq('host_id', session.user.id)
        .eq('status', 'waiting')
        .select()
        .single();

      if (error) throw error;

      setRoom(data);
      setMessage('La partie est lancée !');
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  // Déconnexion
  async function signOut() {
    setMessage('');

    const { error } = await supabase.auth.signOut();

    if (error) {
      setMessage(error.message);
    }
  }

  // Écran de chargement
  if (loading) {
    return (
      <main className="container">
        <p>Chargement...</p>
      </main>
    );
  }

  // Écran de connexion
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

          <label htmlFor="email">
            Adresse e-mail
          </label>

          <input
            id="email"
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="ton@email.com"
          />

          <label htmlFor="password">
            Mot de passe
          </label>

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

  // Écran principal
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

      {room ? (
        <section className="welcome">
          <p className="subtitle">
            SALON PRIVÉ
          </p>

          <h1>Salon {room.code}</h1>

          <p className="description">
            Partage ce code avec tes amis pour
            qu'ils puissent retrouver ton salon.
          </p>

          <div className="buttons">
            <button
              onClick={() =>
                navigator.clipboard
                  .writeText(room.code)
                  .then(() =>
                    setMessage('Code copié !')
                  )
                  .catch(() =>
                    setMessage(
                      'Copie le code affiché.'
                    )
                  )
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

          <div>
            <h3>
              Joueurs dans le salon ({players.length})
            </h3>

            {players.map(player => (
              <p key={player.id}>
                👤 {player.username}
                {player.id === room.host_id
                  ? ' 👑 Hôte'
                  : ''}
              </p>
            ))}
          </div>

          {room.status === 'waiting' ? (
            room.host_id === session.user.id ? (
              <div className="buttons">
                <button
                  disabled={
                    busy || players.length < 2
                  }
                  onClick={startGame}
                >
                  {busy
                    ? 'Lancement...'
                    : 'Lancer la partie'}
                </button>

                {players.length < 2 && (
                  <p>
                    En attente d'un deuxième joueur...
                  </p>
                )}
              </div>
            ) : (
              <p className="description">
                En attente du lancement par l'hôte...
              </p>
            )
          ) : (
            <div>
              <h2>La partie est lancée !</h2>

              <p className="description">
                Préparation des catégories et
                de la première lettre...
              </p>
            </div>
          )}

          <p role="status">{message}</p>
        </section>
      ) : (
        <section className="welcome">
          <p className="subtitle">
            MON ESPACE
          </p>

          <h1>Bienvenue !</h1>

          <p className="description">
            Ton compte est connecté.
          </p>

          <label htmlFor="pseudo">
            Ton pseudo
          </label>

          <input
            id="pseudo"
            value={pseudo}
            onChange={e =>
              setPseudo(e.target.value)
            }
            placeholder="Choisis ton pseudo"
          />

          <div className="buttons">
            <button
              disabled={busy}
              onClick={savePseudo}
            >
              Enregistrer mon pseudo
            </button>
          </div>

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
                  setCode(
                    e.target.value.toUpperCase()
                  )
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
      )}
    </main>
  );
}
