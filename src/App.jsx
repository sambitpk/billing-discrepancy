import React, { useState } from 'react'
import DiscrepancyFinder from './DiscrepancyFinder'
import { Lock, User, Activity } from 'lucide-react'
import './App.css'

function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleLogin = (e) => {
    e.preventDefault();
    // Dummy login: any non-empty username/password will work
    if (username.trim() && password.trim()) {
      setIsLoggedIn(true);
    } else {
      setError("Please enter a username and password.");
    }
  };

  if (!isLoggedIn) {
    return (
      <div className="login-wrapper">
        <div className="login-card">
          <div className="login-header">
            <Activity className="login-logo" size={32} />
            <h2>TatvaCare Admin</h2>
            <p>Sign in to access Billing Finder</p>
          </div>
          <form onSubmit={handleLogin} className="login-form">
            {error && <div className="login-error">{error}</div>}
            
            <div className="form-group">
              <label>Username</label>
              <div className="input-with-icon">
                <User size={18} className="input-icon" />
                <input 
                  type="text" 
                  value={username} 
                  onChange={(e) => setUsername(e.target.value)} 
                  placeholder="Enter username"
                  autoComplete="off"
                />
              </div>
            </div>
            
            <div className="form-group">
              <label>Password</label>
              <div className="input-with-icon">
                <Lock size={18} className="input-icon" />
                <input 
                  type="password" 
                  value={password} 
                  onChange={(e) => setPassword(e.target.value)} 
                  placeholder="Enter password"
                />
              </div>
            </div>
            
            <button type="submit" className="btn-login">Secure Sign In</button>
          </form>
          <div className="login-footer">
            Protected by TatvaCare Security
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="App">
      <DiscrepancyFinder />
    </div>
  )
}

export default App
