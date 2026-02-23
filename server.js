/**
 * Trade Copier API - Backend Node.js
 * 
 * Recebe sinais do Master e distribui para Slaves.
 * Controle de execução por slave (cada sinal executado apenas 1x por slave).
 */

const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// =============================================================================
// Armazenamento em memória (substituir por banco em produção)
// =============================================================================

/** Lista de sinais recebidos do Master - cada sinal tem ID único */
const signals = [];

/** Controle de execução: slaveId -> Set de signalIds já executados */
const executedBySlave = new Map(); // slaveId -> Set<signalId>

/** ID incremental para sinais */
let nextSignalId = 1;

// =============================================================================
// Utilitários
// =============================================================================

/**
 * Gera ID único para o sinal (evita duplicação por ticket+action+timestamp)
 */
function generateSignalId(signal) {
  return `sig_${signal.master_id}_${signal.ticket}_${signal.action}_${Date.now()}`;
}

/**
 * Registra que um slave executou um sinal (evita duplicação)
 */
function markAsExecuted(slaveId, signalId) {
  if (!executedBySlave.has(slaveId)) {
    executedBySlave.set(slaveId, new Set());
  }
  executedBySlave.get(slaveId).add(signalId);
}

/**
 * Verifica se o slave já executou este sinal
 */
function wasExecuted(slaveId, signalId) {
  return executedBySlave.has(slaveId) && executedBySlave.get(slaveId).has(signalId);
}

/**
 * Retorna sinais pendentes para um slave (ainda não executados)
 */
function getPendingSignals(slaveId) {
  return signals.filter(s => !wasExecuted(slaveId, s.id));
}

// =============================================================================
// Endpoints
// =============================================================================

/**
 * POST /signal
 * Master envia novo sinal (abertura, fechamento ou modificação)
 */
app.post('/signal', (req, res) => {
  try {
    const {
      master_id,
      ticket,
      symbol,
      type,
      lot,
      open_price,
      sl,
      tp,
      action
    } = req.body;

    // Validação mínima
    if (!master_id || !ticket || !symbol || !action) {
      return res.status(400).json({
        success: false,
        error: 'Campos obrigatórios: master_id, ticket, symbol, action'
      });
    }

    if (!['OPEN', 'CLOSE', 'MODIFY'].includes(action)) {
      return res.status(400).json({
        success: false,
        error: 'action deve ser OPEN, CLOSE ou MODIFY'
      });
    }

    const signal = {
      id: generateSignalId(req.body),
      master_id: String(master_id),
      ticket: Number(ticket),
      symbol: String(symbol),
      type: type || 'BUY',
      lot: parseFloat(lot) || 0.01,
      open_price: parseFloat(open_price) || 0,
      sl: parseFloat(sl) || 0,
      tp: parseFloat(tp) || 0,
      action: action,
      created_at: new Date().toISOString()
    };

    signals.push(signal);

    console.log(`[SIGNAL] Recebido: ${signal.action} ${signal.symbol} ticket=${signal.ticket} id=${signal.id}`);

    res.json({ success: true, signal_id: signal.id });
  } catch (err) {
    console.error('[ERROR] POST /signal:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /signal/:slaveId
 * Slave consulta sinais pendentes (ainda não executados por ele)
 */
app.get('/signal/:slaveId', (req, res) => {
  try {
    const slaveId = req.params.slaveId;

    if (!slaveId) {
      return res.status(400).json({ success: false, error: 'slaveId obrigatório' });
    }

    const pending = getPendingSignals(slaveId);

    res.json({
      success: true,
      signals: pending,
      count: pending.length
    });
  } catch (err) {
    console.error('[ERROR] GET /signal/:slaveId:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /signal/:slaveId/executed
 * Slave confirma que executou um sinal (evita reexecução)
 * Alternativa: podemos considerar que o GET já retorna os pendentes e o Slave
 * confirma após executar. Aqui usamos abordagem de "consumo": ao retornar
 * no GET, o Slave marca como executado internamente após processar.
 * 
 * Para simplificar: o Slave chama este endpoint após executar cada sinal.
 */
app.post('/signal/:slaveId/executed', (req, res) => {
  try {
    const slaveId = req.params.slaveId;
    const { signal_id } = req.body;

    if (!slaveId || !signal_id) {
      return res.status(400).json({ success: false, error: 'slaveId e signal_id obrigatórios' });
    }

    markAsExecuted(slaveId, signal_id);

    res.json({ success: true });
  } catch (err) {
    console.error('[ERROR] POST /signal/:slaveId/executed:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /health
 * Health check
 */
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// =============================================================================
// Inicialização
// =============================================================================

const HOST = process.env.HOST || '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(JSON.stringify({
    event: 'server_started',
    msg: 'Trade Copier API ready',
    port: PORT,
    host: HOST,
    endpoints: {
      signal: 'POST /signal',
      pending: 'GET /signal/:slaveId',
      executed: 'POST /signal/:slaveId/executed',
      health: 'GET /health'
    }
  }));
});
