
import { useState } from 'react';

export default function App() {
  const [pseudo, setPseudo] = useState('');
  const [code, setCode] = useState('');

  return (
    <main className="container">
      <header>
        <span className="logo">PETIT BAC</span>
        <span className="tag">EN LIGNE</span>
      </header>

      <section className="welcome">
        <p className="subtitle">LE JEU ENTRE AMIS</p>
        <h1>Que la meilleure<br />réponse gagne.</h1>
        <p className="description">
          Retrouve tes amis et teste ta culture générale.
        </p>

        <label>Ton pseudo</label>
        <input
          value={pseudo}
          onChange={(e) => setPseudo(e.target.value)}
          placeholder="Entre ton pseudo"
        />

        <div className="buttons">
          <button onClick={() => alert('Création bientôt disponible !')}>
            Créer une partie
          </button>

          <div className="join">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="Code du salon"
            />
            <button className="secondary" onClick={() => alert('Rejoindre bientôt disponible !')}>
              Rejoindre
            </button>
          </div>
        </div>
      </section>

      <footer>UN PETIT BAC. DE GRANDES AMBITIONS.</footer>
    </main>
  );
}
