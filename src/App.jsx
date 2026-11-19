
import React, { useState, useEffect } from 'react';
import { supabase } from './supabase';

export default function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pseudo, setPseudo] = useState('');
  const [code, setCode] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data, error }) => {
      if (error) setMessage(error.message);
      setSession(data?.session ?? null);
      setLoading(false);
    });

    const { data: listener } =
      supabase.auth.onAuthStateChange((_event, session) => {
        setSession(session);
      });

    return () => listener.subscription.unsubscribe();
  }, []);

  async function handleAuth(action) {
    setBusy(true);
    setMessage('');

    const { error } = action === 'signup'
      ? await supabase.auth.signUp({
          email,
          password
        })
      : await supabase.auth.signInWithPassword({
          email,
          password
        });

    setBusy(false);

    if (error) {
      setMessage(error.message);
    } else if (action === 'signup') {
      setMessage(
        'Compte créé ! Vérifie tes e-mails pour confirmer ton inscription si nécessaire.'
      );
    }
  }

  async function savePseudo() {
    if (!pseudo.trim()) {
      setMessage('Choisis un pseudo.');
      return;
    }

    const { error } = await supabase
      .from('profiles')
      .upsert({
        id: session.user.id,
        username: pseudo.trim()
      });

    setMessage(
      error ? error.message : 'Pseudo enregistré !'
    );
  }

  if (loading) {
    return <main className="container">Chargement...</main>;
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

          <label>Adresse e-mail</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="ton@email.com"
          />

          <label>Mot de passe</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
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

          <p>{message}</p>
        </section>
      </main>
    );
  }

  return (
    <main className="container">
      <header>
        <span className="logo">PETIT BAC</span>
        <button
          className="secondary"
          onClick={() => supabase.auth.signOut()}
        >
          Déconnexion
        </button>
      </header>

      <section className="welcome">
        <p className="subtitle">MON ESPACE</p>
        <h1>Bienvenue !</h1>
        <p className="description">
          Ton compte est connecté.
        </p>

        <label>Ton pseudo</label>
        <input
          value={pseudo}
          onChange={(e) => setPseudo(e.target.value)}
          placeholder="Choisis ton pseudo"
        />

        <div className="buttons">
          <button onClick={savePseudo}>
            Enregistrer mon pseudo
          </button>
        </div>

        <div className="buttons">
          <button
            onClick={() =>
              setMessage('Création des salons à venir !')
            }
          >
            Créer une partie
          </button>

          <div className="join">
            <input
              value={code}
              onChange={(e) =>
                setCode(e.target.value.toUpperCase())
              }
              placeholder="Code du salon"
            />
            <button
              className="secondary"
              onClick={() =>
                setMessage('Rejoindre bientôt disponible !')
              }
            >
              Rejoindre
            </button>
          </div>
        </div>

        <p>{message}</p>
      </section>
    </main>
  );
}
