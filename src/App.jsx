
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
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

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
    return () => { active = false; };
  }, [session?.user?.id]);

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

  function generateCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const values = new Uint32Array(6);
    crypto.getRandomValues(values);

    return Array.from(values, value =>
      chars[value % chars.length]
    ).join('');
  }

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

      setRoom(created);
      setCode(created.code);
      setMessage('Salon créé avec succès !');
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

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
        setMessage('Cette partie a déjà commencé ou est terminée.');
        return;
      }

      setRoom(data);
      setCode(data.code);
      setMessage('Salon trouvé !');
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    setMessage('');
    const { error } = await supabase.auth.signOut();
    if (error) setMessage(error.message);
  }

  if (loading) {
    return (
      <main className="container">
        <p>Chargement...</p>
      </main>
    );
  }

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

  return (
    <main className="container">
      <header>
        <span className="logo">PETIT BAC</span>
        <button className="secondary" onClick={signOut}>
          Déconnexion
        </button>
      </header>

      {room ? (
        <section className="welcome">
          <p className="subtitle">SALON PRIVÉ</p>
          <h1>Salon {room.code}</h1>
          <p className="description">
            Partage ce code avec tes amis pour qu'ils
            puissent retrouver ton salon.
          </p>

          <div className="buttons">
            <button
              onClick={() =>
                navigator.clipboard.writeText(room.code)
                  .then(() => setMessage('Code copié !'))
                  .catch(() => setMessage('Copie le code affiché.'))
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

          <p className="description">
            Le salon est accessible. La liste des joueurs
            et le lancement des manches seront ajoutés ensuite.
          </p>

          <p role="status">{message}</p>
        </section>
      ) : (
        <section className="welcome">
          <p className="subtitle">MON ESPACE</p>
          <h1>Bienvenue !</h1>
          <p className="description">
            Ton compte est connecté.
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
      )}
    </main>
  );
}
