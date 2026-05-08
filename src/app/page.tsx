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
  { nome: "Sinot Clav", freq: "12 em 12 horas", dias: 14, inicio: "2026-05-07", horarios: ["08:39", "20:39"] },
  { nome: "Prednisolona", freq: "1x ao dia", dias: 5, inicio: "2026-05-07", horarios: ["08:39"] },
  { nome: "Traumeel", freq: "8 em 8 horas", dias: 7, inicio: "2026-05-07", horarios: ["08:42", "16:42", "00:42"] },
  { nome: "Dipirona", freq: "6 em 6 horas se dor", dias: 30, inicio: "2026-05-07", horarios: ["00:00", "06:00", "12:00", "18:00"] },
  { nome: "Bactroban", freq: "4x por dia", dias: 90, inicio: "2026-05-07", horarios: ["18:00", "00:00", "06:00", "12:00"] },
  { nome: "Soro Fisiológico", freq: "6x por dia", dias: 30, inicio: "2026-05-07", horarios: ["18:00", "21:00", "00:00", "03:00", "06:00", "09:00"] },
  { nome: "Nasoar", freq: "2x por dia", dias: 21, inicio: "2026-05-07", horarios: ["18:00", "06:00"] },
  { nome: "Cloridrato de Nafazolina", freq: "8 em 8 horas", dias: 7, inicio: "2026-05-07", horarios: ["18:00", "02:00", "10:00"] },
  { nome: "Hirudoid", freq: "4 em 4 horas", dias: 30, inicio: "2026-05-07", horarios: ["18:00", "22:00", "02:00", "06:00"] },
  { nome: "Gelo nos roxos", freq: "20 min de 2 em 2 horas", dias: 14, inicio: "2026-05-07", horarios: ["20:00", "22:00", "00:00"] },
  { nome: "Kelo-Cote UV Gel", freq: "2x ao dia", dias: 90, inicio: "2026-05-20", horarios: ["08:00", "20:00"] }
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
  const [countdowns, setCountdowns] = useState<Array<{ nome: string; freq: string; horario: string; diff: number; id: string }>>([]);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushLoading, setPushLoading] = useState(false);
  const [swReady, setSwReady] = useState(false);
  const [swError, setSwError] = useState('');
  const [whatsappStatus, setWhatsappStatus] = useState<string>('checking');
  const [whatsappQR, setWhatsappQR] = useState<string | null>(null);
  const [showQR, setShowQR] = useState(false);
  const ultimoAlertaRef = useRef('');
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Initialize marcacoes from localStorage
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

  // Check WhatsApp status periodically
  useEffect(() => {
    let cancelled = false;
    const checkWhatsapp = async () => {
      try {
        const response = await fetch('/api/whatsapp-status');
        const data = await response.json();
        if (!cancelled) setWhatsappStatus(data.status || 'offline');
        if (data.status === 'connected') {
          if (!cancelled) setWhatsappQR(null);
        } else if (data.status === 'connecting') {
          // Try to get QR code
          try {
            const qrResponse = await fetch('/api/whatsapp-qr');
            const qrData = await qrResponse.json();
            if (!cancelled && qrData.qr) setWhatsappQR(qrData.qr);
          } catch { /* ignore */ }
        }
      } catch {
        if (!cancelled) setWhatsappStatus('offline');
      }
    };
    checkWhatsapp();
    const interval = setInterval(checkWhatsapp, 15000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  // Register Service Worker
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    let cancelled = false;
    const registerSW = async () => {
      try {
        const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
        if (cancelled) return;
        if (registration.active) {
          const subscription = await registration.pushManager.getSubscription();
          if (!cancelled) { setPushEnabled(!!subscription); setSwReady(true); setSwError(''); }
        } else {
          const readyReg = await navigator.serviceWorker.ready;
          if (!cancelled) {
            const subscription = await readyReg.pushManager.getSubscription();
            setPushEnabled(!!subscription); setSwReady(true); setSwError('');
          }
        }
      } catch (error) {
        if (!cancelled) setSwError('Erro ao registrar Service Worker. Tente recarregar a página.');
      }
    };
    registerSW();
    return () => { cancelled = true; };
  }, []);

  const platform = typeof window !== 'undefined' ? detectPlatform() : { isStandalone: false, isIOS: false, hasNotificationAPI: false, hasServiceWorker: false };

  // Enable push notifications
  const enablePush = async () => {
    setPushLoading(true);
    const { isStandalone, isIOS, hasNotificationAPI, hasServiceWorker } = detectPlatform();
    if (!hasNotificationAPI) {
      if (isIOS) {
        alert(isStandalone
          ? '⚠️ Seu iPhone precisa do iOS 16.4+ para notificações push.\n\nVerifique em: Ajustes → Geral → Sobre → Versão'
          : '📱 No iPhone, as notificações SÓ funcionam como app instalado!\n\n1. Toque no ícone de COMPARTILHAR (⬆️) na parte de BAIXO do Safari\n2. Toque em "Adicionar à Tela Inicial"\n3. FECHE o Safari e abra pelo ÍCONE na tela inicial\n4. Clique em "Ativar Notificações"\n\n⚠️ Requer iOS 16.4+');
      } else {
        alert('Seu navegador não suporta notificações push.\n\nTente usar o Google Chrome atualizado.');
      }
      setPushLoading(false); return;
    }
    if (!hasServiceWorker) { alert('Seu navegador não suporta Service Workers.'); setPushLoading(false); return; }
    try {
      const permission = await window.Notification.requestPermission();
      if (permission !== 'granted') { alert('Permissão de notificação negada.'); setPushLoading(false); return; }
      let registration: ServiceWorkerRegistration;
      try { registration = await navigator.serviceWorker.ready; }
      catch {
        try { registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' }); await new Promise(r => setTimeout(r, 1000)); registration = await navigator.serviceWorker.ready; }
        catch { alert('Não foi possível registrar o Service Worker.'); setPushLoading(false); return; }
      }
      const vapidResponse = await fetch('/api/vapid-public-key');
      const { publicKey } = await vapidResponse.json();
      if (!publicKey) { alert('Erro: chave VAPID não configurada.'); setPushLoading(false); return; }
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) { subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: publicKey }); }
      const saveResponse = await fetch('/api/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subscription }) });
      if (saveResponse.ok) { setPushEnabled(true); setSwReady(true); setSwError(''); alert('✅ Notificações push ativadas!'); }
      else { alert('Erro ao salvar inscrição.'); }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : '';
      if (msg.includes('Notification')) { alert('📱 No iPhone, as notificações SÓ funcionam como app instalado!\n\nAdicione à tela inicial e abra pelo ícone.\n⚠️ Requer iOS 16.4+'); }
      else { alert(`Erro ao ativar notificações: ${msg || 'Tente novamente.'}`); }
    }
    setPushLoading(false);
  };

  // Toggle medication taken
  const toggle = useCallback((id: string) => {
    setMarcacoes(prev => {
      const updated = { ...prev, [id]: !prev[id] };
      if (!prev[id]) {
        fetch('/api/medication-log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ medicationKey: id, takenAt: new Date().toISOString() }) }).catch(() => {});
      }
      return updated;
    });
  }, []);

  const exportarJSON = () => {
    const blob = new Blob([JSON.stringify(marcacoes, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'controle.json'; a.click();
  };

  const importarJSON = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => { const result = e.target?.result; if (typeof result === 'string') setMarcacoes(JSON.parse(result)); };
    reader.readAsText(file);
  };

  const vibrar = () => { if (navigator.vibrate) navigator.vibrate([500, 300, 500]); };
  const tocarSom = () => {
    if (!audioRef.current) audioRef.current = new Audio('https://actions.google.com/sounds/v1/alarms/alarm_clock.ogg');
    audioRef.current.play().catch(() => {});
  };

  // Update countdowns every second
  useEffect(() => {
    const update = () => {
      const agora = new Date();
      let proximo: Date | null = null;
      let nomeProximo = '';
      const upcoming: Array<{ nome: string; freq: string; horario: string; diff: number; id: string }> = [];

      TRATAMENTOS.forEach((t, index) => {
        for (let d = 0; d < t.dias; d++) {
          const base = addDays(new Date(t.inicio + 'T00:00:00'), d);
          for (let h = 0; h < t.horarios.length; h++) {
            const horario = t.horarios[h];
            const [hrs, mins] = horario.split(':').map(Number);
            const data = new Date(base); data.setHours(hrs, mins, 0, 0);
            const id = `${index}_${d}_${h}`;
            const diff = data.getTime() - agora.getTime();

            // Find the very next one
            if (diff > 0 && !marcacoes[id]) {
              if (!proximo || data < proximo) { proximo = data; nomeProximo = t.nome; }
            }

            // All medications within 1 hour (3600000ms) that are NOT taken
            if (diff > 0 && diff <= 3600000 && !marcacoes[id]) {
              upcoming.push({ nome: t.nome, freq: t.freq, horario, diff, id });
            }
          }
        }
      });

      // Sort by time (soonest first)
      upcoming.sort((a, b) => a.diff - b.diff);

      if (!proximo) {
        setProximoInfo({ nome: '✅ Tudo concluído', contador: '' });
      } else {
        const diff = proximo.getTime() - agora.getTime();
        const horas = Math.floor(diff / 1000 / 60 / 60);
        const minutos = Math.floor((diff / 1000 / 60) % 60);
        const segundos = Math.floor((diff / 1000) % 60);
        setProximoInfo({ nome: nomeProximo, contador: `${horas}h ${minutos}m ${segundos}s` });

        if (diff <= 1000) {
          const chave = `${nomeProximo}_${proximo.getTime()}`;
          if (ultimoAlertaRef.current !== chave) { ultimoAlertaRef.current = chave; tocarSom(); vibrar(); }
        }
      }

      setCountdowns(upcoming);
    };

    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [marcacoes]);

  // Format countdown
  const formatCountdown = (diff: number) => {
    if (diff <= 0) return 'AGORA!';
    const minutos = Math.floor(diff / 1000 / 60);
    const segundos = Math.floor((diff / 1000) % 60);
    if (minutos >= 60) {
      const horas = Math.floor(minutos / 60);
      const minsRestantes = minutos % 60;
      return `${horas}h ${minsRestantes}m ${segundos}s`;
    }
    return `${minutos}m ${segundos}s`;
  };

  // Get urgency color based on time remaining
  const getUrgencyStyle = (diff: number) => {
    if (diff <= 5 * 60 * 1000) return 'bg-red-700 shadow-[0_0_30px_rgba(255,0,0,0.6)] animate-pulse'; // <=5min: bright red pulse
    if (diff <= 15 * 60 * 1000) return 'bg-red-600 shadow-[0_0_20px_rgba(255,0,0,0.4)]'; // <=15min: red
    if (diff <= 30 * 60 * 1000) return 'bg-orange-600 shadow-[0_0_15px_rgba(255,165,0,0.3)]'; // <=30min: orange
    return 'bg-red-900/80 shadow-[0_0_10px_rgba(255,0,0,0.2)]'; // <=1h: dark red
  };

  const getUrgencyLabel = (diff: number) => {
    if (diff <= 5 * 60 * 1000) return '🔴 AGORA!';
    if (diff <= 15 * 60 * 1000) return '🟠 URGENTE';
    if (diff <= 30 * 60 * 1000) return '🟡 EM BREVE';
    return '⏰ Próximo';
  };

  // Calculate card stats
  const getCardStats = (t: Tratamento, index: number) => {
    let total = 0; let feitos = 0; let possuiPendentes = false;
    for (let d = 0; d < t.dias; d++) {
      for (let h = 0; h < t.horarios.length; h++) {
        const id = `${index}_${d}_${h}`;
        total++;
        if (marcacoes[id]) feitos++; else possuiPendentes = true;
      }
    }
    return { total, feitos, possuiPendentes };
  };

  return (
    <div className="min-h-screen bg-[#111827] text-white p-4 pb-24" style={{ fontFamily: 'Arial, sans-serif' }}>
      <h1 className="text-center text-2xl font-bold mb-4">Pós Operatório</h1>

      {/* Control Panel */}
      <div className="sticky top-0 bg-[#111827] pb-4 z-50">
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <button onClick={exportarJSON} className="bg-gray-700 hover:bg-gray-600 text-white px-4 py-3 rounded-xl text-sm font-medium transition-colors">Exportar JSON</button>
          <label className="bg-gray-700 hover:bg-gray-600 text-white px-4 py-3 rounded-xl text-sm font-medium cursor-pointer transition-colors">
            Importar JSON
            <input type="file" accept=".json" className="hidden" onChange={importarJSON} />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 bg-gray-800 px-3 py-2 rounded-xl cursor-pointer">
            <input type="checkbox" checked={filtroPendentes} onChange={(e) => setFiltroPendentes(e.target.checked)} className="w-4 h-4" />
            <span className="text-sm">Somente Pendentes</span>
          </label>
          <button onClick={enablePush} disabled={pushLoading || pushEnabled} className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${pushEnabled ? 'bg-green-700 text-green-100 cursor-default' : pushLoading ? 'bg-yellow-700 text-yellow-100 cursor-wait' : 'bg-red-600 hover:bg-red-500 text-white'}`}>
            {pushEnabled ? '🔔 Notificações Ativas' : pushLoading ? '⏳ Ativando...' : '🔔 Ativar Notificações'}
          </button>
        </div>
        {swError && !pushEnabled && <div className="mt-2 text-red-400 text-xs">⚠️ {swError}</div>}
        {!swReady && !swError && !pushEnabled && <div className="mt-2 text-yellow-400 text-xs animate-pulse">⏳ Preparando sistema de notificações...</div>}
      </div>

      {/* WhatsApp Connection Status */}
      <div className="mb-5">
        <button
          onClick={() => setShowQR(!showQR)}
          className={`w-full px-4 py-3 rounded-xl text-sm font-medium transition-colors flex items-center justify-between ${
            whatsappStatus === 'connected' ? 'bg-green-800 hover:bg-green-700' :
            whatsappStatus === 'connecting' ? 'bg-yellow-800 hover:bg-yellow-700' :
            whatsappStatus === 'checking' ? 'bg-gray-700 hover:bg-gray-600' :
            'bg-red-800 hover:bg-red-700'
          }`}
        >
          <span>
            {whatsappStatus === 'connected' ? '📱 WhatsApp Conectado' :
             whatsappStatus === 'connecting' ? '⏳ WhatsApp Conectando...' :
             whatsappStatus === 'checking' ? '🔄 Verificando WhatsApp...' :
             '📵 WhatsApp Desconectado'}
          </span>
          <span className="text-lg">{showQR ? '▲' : '▼'}</span>
        </button>
        {showQR && (
          <div className="bg-[#1f2937] rounded-b-xl p-4 mt-0">
            {whatsappStatus === 'connected' ? (
              <div className="text-center">
                <div className="text-green-400 text-lg font-bold mb-2">✅ WhatsApp Ativo!</div>
                <div className="text-sm text-gray-400">Mensagens serão enviadas automaticamente para:</div>
                <div className="mt-2 space-y-1 text-sm">
                  <div className="text-gray-300">📱 +55 62 98120-6800</div>
                  <div className="text-gray-300">📱 +55 62 98209-3453</div>
                  <div className="text-gray-300">📱 +55 62 98306-8941</div>
                </div>
              </div>
            ) : whatsappQR ? (
              <div className="text-center">
                <div className="text-yellow-400 font-bold mb-3">📱 Escaneie o QR Code com o WhatsApp</div>
                <div className="bg-white p-3 rounded-xl inline-block mb-3">
                  <canvas
                    ref={(canvas) => {
                      if (canvas && whatsappQR) {
                        import('qrcode').then((QRCode) => {
                          QRCode.toCanvas(canvas, whatsappQR, {
                            width: 280,
                            margin: 2,
                            color: { dark: '#000000', light: '#ffffff' },
                          });
                        }).catch(() => {});
                      }
                    }}
                  />
                </div>
                <div className="text-xs text-gray-400 space-y-1">
                  <div>1. Abra o <strong>WhatsApp</strong> no celular</div>
                  <div>2. Vá em <strong>Ajustes → Aparelhos conectados</strong></div>
                  <div>3. Toque em <strong>Conectar um aparelho</strong></div>
                  <div>4. Escaneie o QR code acima</div>
                </div>
              </div>
            ) : (
              <div className="text-center text-gray-400">
                <div className="animate-pulse mb-2">⏳ Aguardando QR Code...</div>
                <div className="text-xs">Certifique-se de que o serviço WhatsApp está rodando.</div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* NEXT Medication Card - main one */}
      <div className="bg-red-600 rounded-2xl p-5 mb-5 shadow-[0_0_20px_rgba(255,0,0,0.4)]">
        <div className="text-2xl font-bold">{proximoInfo.nome}</div>
        <div className="mt-2 text-xl font-mono">{proximoInfo.contador}</div>
      </div>

      {/* ALL Countdown Cards - medications within 1 hour */}
      {countdowns.length > 0 && (
        <div className="mb-5">
          <div className="text-lg font-bold mb-3 text-red-400">⏰ Próximos em até 1 hora ({countdowns.length})</div>
          <div className="space-y-3">
            {countdowns.map((item, idx) => (
              <div key={item.id} className={`${getUrgencyStyle(item.diff)} rounded-2xl p-4 transition-all`}>
                <div className="flex justify-between items-center">
                  <div>
                    <div className="text-xs font-medium opacity-80 mb-1">{getUrgencyLabel(item.diff)}</div>
                    <div className="text-lg font-bold">{item.nome}</div>
                    <div className="text-sm opacity-70">{item.freq} - {item.horario}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-mono font-bold">{formatCountdown(item.diff)}</div>
                    <label className="inline-flex items-center gap-2 mt-2 bg-white/20 hover:bg-white/30 px-3 py-1.5 rounded-lg cursor-pointer transition-colors">
                      <input
                        type="checkbox"
                        checked={!!marcacoes[item.id]}
                        onChange={() => toggle(item.id)}
                        className="w-4 h-4"
                      />
                      <span className="text-sm">Tomei</span>
                    </label>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* No medications within 1 hour */}
      {countdowns.length === 0 && proximoInfo.nome !== '✅ Tudo concluído' && (
        <div className="bg-gray-800 rounded-2xl p-4 mb-5 text-center text-gray-400">
          <div className="text-lg">😌 Nenhum remédio nas próximas horas</div>
        </div>
      )}

      {/* Treatment Cards */}
      <div className="space-y-3">
        {TRATAMENTOS.map((t, index) => {
          const { total, feitos, possuiPendentes } = getCardStats(t, index);
          if (filtroPendentes && !possuiPendentes) return null;
          const isAberto = cardAberto === index;
          const progresso = total > 0 ? Math.round((feitos / total) * 100) : 0;

          return (
            <div key={index} className="bg-[#1f2937] rounded-2xl overflow-hidden">
              <div className="p-4 cursor-pointer hover:bg-[#283548] transition-colors" onClick={() => setCardAberto(isAberto ? null : index)}>
                <div className="flex justify-between items-start">
                  <div>
                    <div className="text-xl font-bold">{t.nome}</div>
                    <div className="mt-1 text-gray-300 text-sm">{t.freq}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm text-gray-400">{feitos}/{total}</div>
                    <div className="w-20 bg-gray-700 rounded-full h-2 mt-1">
                      <div className="bg-green-500 h-2 rounded-full transition-all" style={{ width: `${progresso}%` }} />
                    </div>
                  </div>
                </div>
                {possuiPendentes ? <div className="mt-2 text-green-400 font-bold text-sm">Pendentes</div> : <div className="mt-2 text-green-400 font-bold text-sm">✅ Concluído</div>}
              </div>
              {isAberto && (
                <div className="p-4 bg-[#0f172a] max-h-[60vh] overflow-y-auto">
                  {Array.from({ length: t.dias }, (_, d) => {
                    const data = addDays(new Date(t.inicio + 'T00:00:00'), d);
                    return (
                      <div key={d} className="bg-[#1e293b] rounded-xl p-3 mb-3">
                        <div className="font-bold mb-2 text-sm">Dia {d + 1} - {formatarData(data)}</div>
                        <div className="flex flex-wrap gap-2">
                          {t.horarios.map((h, i) => {
                            const id = `${index}_${d}_${i}`;
                            const checked = !!marcacoes[id];
                            return (
                              <label key={i} className={`flex items-center gap-2 px-3 py-2 rounded-xl cursor-pointer transition-colors ${checked ? 'bg-green-900/50 line-through opacity-70' : 'bg-[#374151] hover:bg-[#4b5563]'}`}>
                                <input type="checkbox" checked={checked} onChange={() => toggle(id)} className="w-4 h-4" />
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

      {/* iOS Instructions */}
      {platform.isIOS && !platform.isStandalone && !pushEnabled && (
        <div className="mt-6 bg-blue-900/30 border border-blue-500/50 rounded-xl p-4">
          <div className="font-bold text-blue-400 mb-2">📱 iPhone: Siga estes passos!</div>
          <div className="text-sm text-blue-200/80 space-y-2">
            <div>No iPhone, as notificações push SÓ funcionam como app instalado.</div>
            <div className="bg-blue-900/40 rounded-lg p-3 space-y-1">
              <div>1️⃣ Toque no ícone <strong>COMPARTILHAR</strong> (⬆️) na parte de BAIXO</div>
              <div>2️⃣ Toque em <strong>&quot;Adicionar à Tela Inicial&quot;</strong></div>
              <div>3️⃣ <strong>FECHE o Safari</strong> e abra pelo <strong>ícone na tela inicial</strong></div>
              <div>4️⃣ Clique em <strong>&quot;🔔 Ativar Notificações&quot;</strong></div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
