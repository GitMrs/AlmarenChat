import React, { useState } from 'react';
import { Mail, Lock, User, ArrowRight, ChevronLeft, MessageSquare } from 'lucide-react';
import { cn } from '../lib/utils';

interface LoginScreenProps {
  onLogin: () => void;
}

export function LoginScreen({ onLogin }: LoginScreenProps) {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (email && password) {
      onLogin();
    }
  };

  return (
    <div className="flex flex-col md:flex-row h-full w-full bg-white relative">
      {/* Desktop Left Branding Panel */}
      <div className="hidden md:flex md:w-[45%] bg-[#1e2329] p-12 lg:p-16 flex-col justify-between relative overflow-hidden text-white">
         <div className="absolute top-0 right-0 p-12 opacity-10 blur-3xl pointer-events-none">
            <div className="w-96 h-96 bg-white rounded-full"></div>
         </div>
         
         <div className="relative z-10 flex items-center gap-3">
           <div className="w-12 h-12 bg-white/10 rounded-2xl flex items-center justify-center backdrop-blur-sm border border-white/10">
             <MessageSquare size={28} className="text-white" />
           </div>
           <span className="text-2xl font-bold tracking-tight">Almaren</span>
         </div>

         <div className="relative z-10 space-y-6">
           <h2 className="text-4xl lg:text-5xl font-semibold leading-tight tracking-tight">
             Connect<br/>with your team<br/>instantly.
           </h2>
           <p className="text-gray-400 text-lg max-w-sm font-medium">
             Experience lightning-fast messaging, unlimited chat history, and seamless file sharing.
           </p>
         </div>

         <div className="relative z-10">
           <p className="text-sm text-gray-500 font-medium tracking-wide">© 2026 Almaren Inc.</p>
         </div>
      </div>

      {/* Main Form Area */}
      <div className="flex-1 overflow-y-auto px-6 py-12 md:px-12 lg:px-20 flex flex-col justify-center relative">
        {!isLogin && (
          <button 
            type="button"
            onClick={() => setIsLogin(true)}
            className="absolute top-6 left-6 p-2 text-gray-500 hover:text-black transition-colors rounded-full hover:bg-gray-50 z-20"
          >
            <ChevronLeft size={24} />
          </button>
        )}

        <div className="max-w-md w-full mx-auto md:mx-0">
          <div className="md:hidden w-14 h-14 bg-[#1e2329] rounded-2xl flex items-center justify-center mb-8 shadow-lg">
            <MessageSquare size={28} className="text-white" />
          </div>

          <h1 className="text-4xl font-bold tracking-tight text-gray-900 leading-tight">
            {isLogin ? 'Welcome back' : 'Create account'}
          </h1>
          <p className="mt-2 text-base text-gray-500 font-medium">
            {isLogin ? 'Please enter your details to sign in.' : 'Start your messaging journey with us.'}
          </p>

          <form onSubmit={handleSubmit} className="space-y-5 mt-10">
            {!isLogin && (
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-700">Full Name</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                    <User size={20} className="text-gray-400" />
                  </div>
                  <input 
                    type="text" 
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="John Doe"
                    className="w-full pl-11 pr-4 py-3.5 bg-gray-50 border border-gray-100 rounded-xl outline-none focus:border-gray-300 focus:bg-white focus:ring-4 focus:ring-gray-50 transition-all text-gray-900"
                  />
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-700">Email Address</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                  <Mail size={20} className="text-gray-400" />
                </div>
                <input 
                  type="email" 
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@example.com"
                  required
                  className="w-full pl-11 pr-4 py-3.5 bg-gray-50 border border-gray-100 rounded-xl outline-none focus:border-gray-300 focus:bg-white focus:ring-4 focus:ring-gray-50 transition-all text-gray-900"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-700">Password</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                  <Lock size={20} className="text-gray-400" />
                </div>
                <input 
                  type="password" 
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  className="w-full pl-11 pr-4 py-3.5 bg-gray-50 border border-gray-100 rounded-xl outline-none focus:border-gray-300 focus:bg-white focus:ring-4 focus:ring-gray-50 transition-all text-gray-900"
                />
              </div>
            </div>

            {isLogin && (
              <div className="flex justify-end w-full">
                <button type="button" className="text-sm font-medium text-gray-500 hover:text-black transition-colors">
                  Forgot password?
                </button>
              </div>
            )}

            <button 
              type="submit"
              className="w-full flex items-center justify-center gap-2 bg-[#1e2329] text-white py-4 rounded-xl font-medium text-lg hover:bg-black transition-colors active:scale-[0.98] mt-8 shadow-[0_8px_20px_rgba(0,0,0,0.08)]"
            >
              {isLogin ? 'Sign In' : 'Sign Up'}
              <ArrowRight size={20} />
            </button>

            <button 
              type="button" 
              onClick={() => setIsLogin(!isLogin)}
              className="w-full flex items-center justify-center gap-2 bg-gray-50 border border-gray-200 text-gray-900 py-4 rounded-xl font-medium text-lg hover:bg-gray-100 transition-colors active:scale-[0.98] mt-3"
            >
              {isLogin ? 'Create an account' : 'Log in to existing account'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
