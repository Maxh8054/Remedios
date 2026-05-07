'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

// ==========================================
// Treatment definitions
// ==========================================
interface Tratamento {
  nome: string;
  freq: string;
  dias: number;
  inicio: string;
  horarios: string[];
}

const TRATAMENTOS: Tratamento[] = [
  {
    nome: "Sinot Clav",
    freq: "12 em 12 horas",
    dias: 14,
    inicio: "2026-05-07",
    horarios: ["08:39", "20:39"]
  },
  {
    nome: "Prednisolona",
    freq: "1x ao dia",
    dias: 5,
    inicio: "2026-05-07",
    horarios: ["08:39"]
  },
  {
    nome: "Traumeel",
    freq: "8 em 8 horas",
    dias: 7,
    inicio: "2026-05-07",
    horarios: ["08:42", "16:42", "00:42"]
  },
  {
    nome: "Dipirona",
    freq: "6 em 6 horas se dor",
    dias: 30,
    inicio: "2026-05-07",
    horarios: ["00:00", "06:00", "12:00", "18:00"]
  },
  {
    nome: "Bactroban",
    freq: "4x por dia",
    dias: 90,
    inicio: "2026-05-07",
    horarios: ["18:00", "00:00", "06:00", "12:00"]
  },
  {
    nome: "Soro Fisiológico",
    freq: "6x por dia",
    dias: 30,
    inicio: "2026-05-07",
    horarios: ["18:00", "21:00", "00:00", "03:00", "06:00", "09:00"]
  },
  {
    nome: "Nasoar",
    freq: "2x por dia",
    dias: 21,
    inicio: "2026-05-07",
    horarios: ["18:00", "06:00"]
  },
  {
    nome: "Cloridrato de Nafazolina",
    freq: "8 em 8 horas",
    dias: 7,
    inicio: "2026-05-07",
    horarios: ["18:00", "02:00", "10:00"]
  },
  {
    nome: "Hirudoid",
    freq: "4 em 4 horas",
    dias: 30,
    inicio: "2026-05-07",
    horarios: ["18:00", "22:00", "02:00", "06:00"]
  },
  {
    nome: "Gelo nos roxos",
    freq: "20 min de 2 em 2 horas",
    dias: 14,
    inicio: "2026-05-07",
    horarios: ["20:00", "22:00", "00:00"]
  },
  {
    nome: "Kelo-Cote UV Gel",
    freq: "2x ao dia",
    dias: 90,
    inicio: "2026-05-20",
    horarios: ["08:00", "20:00"]
  }
];

// ==========================================
// Utility functions
// ==========================================
function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function formatarData(date: Date): string {
  return date.toLocaleDateString('pt-BR');
}

// Safe platform detection (never throws)
function detectPlatform() {
  if (typeof window === 'undefined') {
    return { isStandalone: false, isIOS: false, hasNotificationAPI: false, hasServiceWorker: false };
  }
  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as Record<string, unknown>).standalone === true;
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const hasNotificationAPI = 'Notification' in window;
  const hasServiceWorker = 'serviceWorker' in navigator;
  return { isStandalone, isIOS, hasNotificationAPI, hasServiceWorker };
}

// ==========================================
// Main Page Component
// ==========================================
export default function HomePage() {
  const [filtroPendentes, setFiltroPendentes] = useState(false);
  const [cardAberto, setCardAberto] = useState<number | null>(null);
  const [proximoInfo, setProximoInfo] = useState({ nome: 'Carregando...', contador: '' });
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushLoading, setPushLoading] = useState(false);
  const [swReady, setSwReady] = useState(false);
  const [swError, setSwError] = useState('');
  const ultimoAlertaRef = useRef('');
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Initialize marcacoes from localStorage (lazy initializer)
  const [marcacoes, setMarcacoesInner] = useState<Record<string, boolean>>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('marcacoes');
      if (saved) {
        try { return JSON.parse(saved); } catch { /* ignore */ }
      }
    }
    return {};
  });

  const setMarcacoes = useCallback((value: Record<string, boolean> | ((prev: Record<string, boolean>) => Record<string, boolean>)) => {
    setMarcacoesInner(prev => {
      const next = typeof value === 'function' ? value(prev) : value;
      localStorage.setItem('marcacoes', JSON.stringify(next));
      return next;
    });
  }, []);

  // Register Service Worker
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    let cancelled = false;

    const registerSW = async () => {
      try {
        const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
        console.log('SW registered:', registration.scope);

        if (cancelled) return;

        // Wait for the service worker to be ready/active
        if (registration.active) {
          const subscription = await registration.pushManager.getSubscription();
          if (!cancelled) {
            setPushEnabled(!!subscription);
            setSwReady(true);
            setSwError('');
          }
        } else {
          // Also try navigator.serviceWorker.ready as fallback
          const readyReg = await navigator.serviceWorker.ready;
          if (!cancelled) {
            const subscription = await readyReg.pushManager.getSubscription();
            setPushEnabled(!!subscription);
            setSwReady(true);
            setSwError('');
          }
        }
      } catch (error) {
        console.error('SW registration failed:', error);
        if (!cancelled) {
          setSwError('Erro ao registrar Service Worker. Tente recarregar a página.');
        }
      }
    };

    registerSW();

    return () => { cancelled = true; };
  }, []);

  // Detect platform for UI rendering
  const platform = typeof window !== 'undefined' ? detectPlatform() : { isStandalone: false, isIOS: false, hasNotificationAPI: false, hasServiceWorker: false };

  // Enable push notifications
  const enablePush = async () => {
    setPushLoading(true);

    const { isStandalone, isIOS, hasNotificationAPI, hasServiceWorker } = detectPlatform();

    // === Step 1: Check if Notification API exists ===
    // On iOS Safari, Notification only exists in standalone (installed PWA) mode
    if (!hasNotificationAPI) {
      if (isIOS) {
        if (isStandalone) {
          alert(
            '⚠️ Seu iPhone precisa do iOS 16.4 ou superior para notificações push.\n\n' +
            'Verifique em: Ajustes → Geral → Sobre → Versão do iOS'
          );
        } else {
          alert(
            '📱 No iPhone, as notificações SÓ funcionam como app instalado!\n\n' +
            'Siga EXATAMENTE estes passos:\n\n' +
            '1. Toque no ícone de COMPARTILHAR (⬆️ quadrado com seta) na parte de BAIXO do Safari\n' +
            '2. Role para baixo e toque em "Adicionar à Tela Inicial"\n' +
            '3. Toque em "Adicionar"\n' +
            '4. FECHE o Safari e abra o app pelo ÍCONE na tela inicial\n' +
            '5. Dentro do app instalado, clique em "Ativar Notificações"\n\n' +
            '⚠️ Requer iOS 16.4 ou superior'
          );
        }
      } else {
        alert(
          'Seu navegador não suporta notificações push.\n\n' +
          'Tente usar o Google Chrome atualizado.'
        );
      }
      setPushLoading(false);
      return;
    }

    // === Step 2: Check Service Worker support ===
    if (!hasServiceWorker) {
      alert('Seu navegador não suporta Service Workers. Tente usar o Chrome ou Safari atualizado.');
      setPushLoading(false);
      return;
    }

    try {
      // === Step 3: Request notification permission ===
      const permission = await window.Notification.requestPermission();
      if (permission !== 'granted') {
        alert('Permissão de notificação negada. Por favor, permita notificações nas configurações do navegador.');
        setPushLoading(false);
        return;
      }

      // === Step 4: Make sure SW is registered ===
      let registration: ServiceWorkerRegistration;
      try {
        registration = await navigator.serviceWorker.ready;
      } catch {
        try {
          registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
          await new Promise(resolve => setTimeout(resolve, 1000));
          registration = await navigator.serviceWorker.ready;
        } catch {
          alert('Não foi possível registrar o Service Worker. Tente recarregar a página.');
          setPushLoading(false);
          return;
        }
      }

      // === Step 5: Get VAPID public key ===
      const vapidResponse = await fetch('/api/vapid-public-key');
      const { publicKey } = await vapidResponse.json();

      if (!publicKey) {
        alert('Erro: chave VAPID não configurada no servidor.');
        setPushLoading(false);
        return;
      }

      // === Step 6: Register push subscription ===
      let subscription = await registration.pushManager.getSubscription();

      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: publicKey
        });
      }

      // === Step 7: Save subscription to server ===
      const saveResponse = await fetch('/api/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription })
      });

      if (saveResponse.ok) {
        setPushEnabled(true);
        setSwReady(true);
        setSwError('');
        alert('✅ Notificações push ativadas! Você receberá alertas na tela de bloqueio quando for hora de tomar seus remédios.');
      } else {
        alert('Erro ao salvar inscrição no servidor.');
      }
    } catch (error: unknown) {
      console.error('Error enabling push:', error);
      const msg = error instanceof Error ? error.message : '';

      if (msg.includes('Notification') || msg.includes('notification')) {
        alert(
          '📱 No iPhone, as notificações SÓ funcionam como app instalado!\n\n' +
          '1. Toque no ícone de COMPARTILHAR (⬆️) na parte de BAIXO do Safari\n' +
          '2. Toque em "Adicionar à Tela Inicial"\n' +
          '3. Abra o app pelo ÍCONE na tela inicial\n' +
          '4. Clique em "Ativar Notificações" dentro do app\n\n' +
          '⚠️ Requer iOS 16.4+'
        );
      } else if (msg.includes('gcm_sender_id') || msg.includes('manifest')) {
        alert('Erro de configuração do PWA. Adicione o site à tela inicial do celular e abra pelo ícone.');
      } else if (msg.includes('permission') || msg.includes('denied')) {
        alert('Permissão de notificação negada. Vá nas configurações do navegador e permita notificações para este site.');
      } else {
        alert(`Erro ao ativar notificações: ${msg || 'Tente novamente.'}`);
      }
    }
    setPushLoading(false);
  };

  // Toggle medication taken
  const toggle = useCallback((id: string) => {
    setMarcacoes(prev => {
      const updated = { ...prev, [id]: !prev[id] };
      // Also log to server if taken
      if (!prev[id]) {
        fetch('/api/medication-log', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ medicationKey: id, takenAt: new Date().toISOString() })
        }).catch(e => console.error('Error logging medication:', e));
      }
      return updated;
    });
  }, []);

  // Export JSON
  const exportarJSON = () => {
    const blob = new Blob([JSON.stringify(marcacoes, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'controle.json';
    a.click();
  };

  // Import JSON
  const importarJSON = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result;
      if (typeof result === 'string') {
        setMarcacoes(JSON.parse(result));
      }
    };
    reader.readAsText(file);
  };

  // Vibrate
  const vibrar = () => {
    if (navigator.vibrate) {
      navigator.vibrate([500, 300, 500]);
    }
  };

  // Play alarm sound
  const tocarSom = () => {
    if (!audioRef.current) {
      audioRef.current = new Audio('https://actions.google.com/sounds/v1/alarms/alarm_clock.ogg');
    }
    audioRef.current.play().catch(e => console.error('Audio play failed:', e));
  };

  // Update "next medication" counter every second
  useEffect(() => {
    const updateProximo = () => {
      const agora = new Date();
      let proximo: Date | null = null;
      let nome = '';

      TRATAMENTOS.forEach((t, index) => {
        for (let d = 0; d < t.dias; d++) {
          const base = addDays(new Date(t.inicio + 'T00:00:00'), d);
          for (let h = 0; h < t.horarios.length; h++) {
            const horario = t.horarios[h];
            const [hrs, mins] = horario.split(':').map(Number);
            const data = new Date(base);
            data.setHours(hrs, mins, 0, 0);

            const id = `${index}_${d}_${h}`;

            if (data > agora && !marcacoes[id]) {
              if (!proximo || data < proximo) {
                proximo = data;
                nome = t.nome;
              }
            }
          }
        }
      });

      if (!proximo) {
        setProximoInfo({ nome: '✅ Tudo concluído', contador: '' });
        return;
      }

      const diff = proximo.getTime() - agora.getTime();
      const horas = Math.floor(diff / 1000 / 60 / 60);
      const minutos = Math.floor((diff / 1000 / 60) % 60);
      const segundos = Math.floor((diff / 1000) % 60);

      setProximoInfo({
        nome,
        contador: `${horas}h ${minutos}m ${segundos}s`
      });

      // Alert when time arrives (local fallback)
      if (diff <= 1000) {
        const chave = `${nome}_${proximo.getTime()}`;
        if (ultimoAlertaRef.current !== chave) {
          ultimoAlertaRef.current = chave;
          tocarSom();
          vibrar();
        }
      }
    };

    updateProximo();
    const interval = setInterval(updateProximo, 1000);
    return () => clearInterval(interval);
  }, [marcacoes]);

  // Calculate card stats
  const getCardStats = (t: Tratamento, index: number) => {
    let total = 0;
    let feitos = 0;
    let possuiPendentes = false;

    for (let d = 0; d < t.dias; d++) {
      for (let h = 0; h < t.horarios.length; h++) {
        const id = `${index}_${d}_${h}`;
        total++;
        if (marcacoes[id]) {
          feitos++;
        } else {
          possuiPendentes = true;
        }
      }
    }

    return { total, feitos, possuiPendentes };
  };

  return (
    <div className="min-h-screen bg-[#111827] text-white p-4 pb-24" style={{ fontFamily: 'Arial, sans-serif' }}>
      {/* Header */}
      <h1 className="text-center text-2xl font-bold mb-4">Pós Operatório</h1>

      {/* Control Panel */}
      <div className="sticky top-0 bg-[#111827] pb-4 z-50">
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <button
            onClick={exportarJSON}
            className="bg-gray-700 hover:bg-gray-600 text-white px-4 py-3 rounded-xl text-sm font-medium transition-colors"
          >
            Exportar JSON
          </button>
          <label className="bg-gray-700 hover:bg-gray-600 text-white px-4 py-3 rounded-xl text-sm font-medium cursor-pointer transition-colors">
            Importar JSON
            <input
              type="file"
              accept=".json"
              className="hidden"
              onChange={importarJSON}
            />
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 bg-gray-800 px-3 py-2 rounded-xl cursor-pointer">
            <input
              type="checkbox"
              checked={filtroPendentes}
              onChange={(e) => setFiltroPendentes(e.target.checked)}
              className="w-4 h-4"
            />
            <span className="text-sm">Somente Pendentes</span>
          </label>

          <button
            onClick={enablePush}
            disabled={pushLoading || pushEnabled}
            className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
              pushEnabled
                ? 'bg-green-700 text-green-100 cursor-default'
                : pushLoading
                ? 'bg-yellow-700 text-yellow-100 cursor-wait'
                : 'bg-red-600 hover:bg-red-500 text-white'
            }`}
          >
            {pushEnabled ? '🔔 Notificações Ativas' : pushLoading ? '⏳ Ativando...' : '🔔 Ativar Notificações'}
          </button>
        </div>

        {/* SW Status indicator */}
        {swError && !pushEnabled && (
          <div className="mt-2 text-red-400 text-xs">
            ⚠️ {swError}
          </div>
        )}
        {!swReady && !swError && !pushEnabled && (
          <div className="mt-2 text-yellow-400 text-xs animate-pulse">
            ⏳ Preparando sistema de notificações...
          </div>
        )}
      </div>

      {/* Next Medication Card */}
      <div className="bg-red-600 rounded-2xl p-5 mb-5 shadow-[0_0_20px_rgba(255,0,0,0.4)]">
        <div className="text-2xl font-bold">{proximoInfo.nome}</div>
        <div className="mt-2 text-xl font-mono">{proximoInfo.contador}</div>
      </div>

      {/* Treatment Cards */}
      <div className="space-y-3">
        {TRATAMENTOS.map((t, index) => {
          const { total, feitos, possuiPendentes } = getCardStats(t, index);

          if (filtroPendentes && !possuiPendentes) return null;

          const isAberto = cardAberto === index;
          const progresso = total > 0 ? Math.round((feitos / total) * 100) : 0;

          return (
            <div key={index} className="bg-[#1f2937] rounded-2xl overflow-hidden">
              {/* Card Header */}
              <div
                className="p-4 cursor-pointer hover:bg-[#283548] transition-colors"
                onClick={() => setCardAberto(isAberto ? null : index)}
              >
                <div className="flex justify-between items-start">
                  <div>
                    <div className="text-xl font-bold">{t.nome}</div>
                    <div className="mt-1 text-gray-300 text-sm">{t.freq}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm text-gray-400">{feitos}/{total}</div>
                    <div className="w-20 bg-gray-700 rounded-full h-2 mt-1">
                      <div
                        className="bg-green-500 h-2 rounded-full transition-all"
                        style={{ width: `${progresso}%` }}
                      />
                    </div>
                  </div>
                </div>
                {possuiPendentes ? (
                  <div className="mt-2 text-green-400 font-bold text-sm">Pendentes</div>
                ) : (
                  <div className="mt-2 text-green-400 font-bold text-sm">✅ Concluído</div>
                )}
              </div>

              {/* Card Content */}
              {isAberto && (
                <div className="p-4 bg-[#0f172a] max-h-[60vh] overflow-y-auto">
                  {Array.from({ length: t.dias }, (_, d) => {
                    const data = addDays(new Date(t.inicio + 'T00:00:00'), d);

                    return (
                      <div key={d} className="bg-[#1e293b] rounded-xl p-3 mb-3" id={`dia-${index}-${d}`}>
                        <div className="font-bold mb-2 text-sm">
                          Dia {d + 1} - {formatarData(data)}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {t.horarios.map((h, i) => {
                            const id = `${index}_${d}_${i}`;
                            const checked = !!marcacoes[id];

                            return (
                              <label
                                key={i}
                                className={`flex items-center gap-2 px-3 py-2 rounded-xl cursor-pointer transition-colors ${
                                  checked
                                    ? 'bg-green-900/50 line-through opacity-70'
                                    : 'bg-[#374151] hover:bg-[#4b5563]'
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => toggle(id)}
                                  className="w-4 h-4"
                                />
                                <span className="text-sm">{h}</span>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* iOS Install Instructions - shown when on iOS and NOT in standalone mode */}
      {platform.isIOS && !platform.isStandalone && !pushEnabled && (
        <div className="mt-6 bg-blue-900/30 border border-blue-500/50 rounded-xl p-4">
          <div className="font-bold text-blue-400 mb-2">📱 iPhone: Siga estes passos!</div>
          <div className="text-sm text-blue-200/80 space-y-2">
            <div>No iPhone, as notificações push SÓ funcionam quando o app está instalado na tela inicial.</div>
            <div className="font-bold text-blue-300 mt-2">Passo a passo:</div>
            <div className="bg-blue-900/40 rounded-lg p-3 space-y-1">
              <div>1️⃣ Toque no ícone <strong>COMPARTILHAR</strong> (⬆️ quadrado com seta) na parte de BAIXO da tela</div>
              <div>2️⃣ Role para baixo e toque em <strong>&quot;Adicionar à Tela Inicial&quot;</strong></div>
              <div>3️⃣ Toque em <strong>&quot;Adicionar&quot;</strong></div>
              <div>4️⃣ <strong>FECHE o Safari</strong> e abra o app pelo <strong>ícone na tela inicial</strong></div>
              <div>5️⃣ Dentro do app instalado, clique em <strong>&quot;🔔 Ativar Notificações&quot;</strong></div>
            </div>
            <div className="text-xs text-blue-300/60 mt-2">
              ⚠️ Requer iOS 16.4 ou superior. Verifique em: Ajustes → Geral → Sobre → Versão
            </div>
          </div>
        </div>
      )}

      {/* Push notification info - shown when not on iOS or already in standalone mode */}
      {!pushEnabled && !(platform.isIOS && !platform.isStandalone) && (
        <div className="mt-6 bg-yellow-900/30 border border-yellow-700/50 rounded-xl p-4">
          <div className="font-bold text-yellow-400 mb-2">🔔 Ative as notificações!</div>
          <div className="text-sm text-yellow-200/80 mb-3">
            Para receber alertas na tela de bloqueio do celular quando for hora de tomar seus remédios.
          </div>
          <div className="text-sm text-yellow-200/70 space-y-1">
            <div className="font-bold text-yellow-300">📱 Instruções:</div>
            <div>1. Clique em &quot;Ativar Notificações&quot; acima</div>
            <div>2. Permita as notificações quando o navegador perguntar</div>
            <div>3. No menu do navegador (⋮), toque em &quot;Adicionar à tela inicial&quot;</div>
            <div>4. Abra o app pelo ícone na tela inicial</div>
          </div>
        </div>
      )}
    </div>
  );
}
