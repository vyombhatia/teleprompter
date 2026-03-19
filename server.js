const express = require('express');
const http = require('http');
const { WebSocketServer, WebSocket } = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Health check
app.get('/health', (req, res) => res.json({ ok: true }));

// WebSocket proxy to Sarvam AI
wss.on('connection', (clientWs, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const apiKey = url.searchParams.get('key');

  if (!apiKey) {
    clientWs.close(4001, 'Missing API key');
    return;
  }

  // Build Sarvam URL with params (minus the key)
  const sarvamParams = new URLSearchParams({
    'language-code': url.searchParams.get('lang') || 'hi-IN',
    'model': 'saaras:v3',
    'mode': 'transcribe',
    'sample_rate': '16000',
    'input_audio_codec': 'wav',
    'vad_signals': 'true',
  });
  const sarvamUrl = `wss://api.sarvam.ai/speech-to-text/ws?${sarvamParams}`;

  // Connect to Sarvam with the API key header
  const sarvamWs = new WebSocket(sarvamUrl, {
    headers: { 'Api-Subscription-Key': apiKey },
  });

  let sarvamReady = false;
  const queue = [];

  sarvamWs.on('open', () => {
    sarvamReady = true;
    // Flush queued messages
    while (queue.length > 0) {
      sarvamWs.send(queue.shift());
    }
    clientWs.send(JSON.stringify({ type: 'status', message: 'connected' }));
  });

  sarvamWs.on('message', (data) => {
    // Forward Sarvam responses to browser
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(data.toString());
    }
  });

  sarvamWs.on('error', (err) => {
    console.error('Sarvam error:', err.message);
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(JSON.stringify({ type: 'error', data: { error: err.message } }));
    }
  });

  sarvamWs.on('close', (code, reason) => {
    console.log(`Sarvam closed: ${code} ${reason}`);
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.close(code, reason.toString());
    }
  });

  // Forward browser audio to Sarvam
  clientWs.on('message', (data) => {
    const msg = data.toString();
    if (sarvamReady && sarvamWs.readyState === WebSocket.OPEN) {
      sarvamWs.send(msg);
    } else {
      queue.push(msg);
    }
  });

  clientWs.on('close', () => {
    if (sarvamWs.readyState === WebSocket.OPEN || sarvamWs.readyState === WebSocket.CONNECTING) {
      sarvamWs.close();
    }
  });

  clientWs.on('error', (err) => {
    console.error('Client WS error:', err.message);
    if (sarvamWs.readyState === WebSocket.OPEN) {
      sarvamWs.close();
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Teleprompter server running on port ${PORT}`);
});
