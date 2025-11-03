import 'dotenv/config';
import { createBot, createProvider, createFlow, addKeyword, EVENTS, MemoryDB as Database } from '@builderbot/bot';
import { MetaProvider as Provider } from '@builderbot/provider-meta';
import axios from 'axios';
import express from 'express';

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3008;
const BACKEND_API_URL = process.env.BACKEND_API_URL || 'http://localhost:3001';
const BACKEND_API_SECRET = process.env.BACKEND_API_SECRET || 'dev-secret';

let lastRawContext: any = null;

const isCurrentLocation = (locationData: any) => {
  return !locationData?.address && !locationData?.name && !locationData?.url;
};

const locationFlow = addKeyword(EVENTS.LOCATION)
  .addAnswer('Procesando tu ubicación...', null, async (ctx: any, { flowDynamic, state }: any) => {
    const userLatitude = ctx.latitude;
    const userLongitude = ctx.longitude;
    const userName = ctx.pushName || ctx.name || 'Usuario';
    const userPhone = ctx.from;

    await state.update({ last_latitude: userLatitude, last_longitude: userLongitude, last_location_time: Date.now() });

    const locationIsCurrentLocation = isCurrentLocation(
      lastRawContext?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.location
    );

    if (!locationIsCurrentLocation) {
      const fixed = lastRawContext?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.location;
      const message = [
        '⚠️ *UBICACIÓN NO VÁLIDA*',
        '',
        '❌ Me estás enviando una ubicación guardada del mapa.',
        '',
        'No puedo verificar que realmente estés en el lugar.',
        '',
        '📍 *Ubicación rechazada:*',
        `${fixed?.name || 'Punto guardado'}`,
        `${fixed?.address || 'Dirección no disponible'}`,
        '',
        '💡 *Para registrar tu asistencia:*',
        '1️⃣ Toca el ícono de adjuntar (+)',
        '2️⃣ Selecciona "Ubicación"',
        '3️⃣ Elige "Enviar mi ubicación actual"',
        '',
        '¡Inténtalo de nuevo! 🙏',
      ];
      await flowDynamic(message);
      return;
    }

    await flowDynamic([
      '✅ Ubicación actual recibida',
      '',
      '¿Qué deseas hacer?',
      '1️⃣ Marcar entrada (check-in)',
      '2️⃣ Marcar salida (check-out)',
      '',
      'Responde con *1* o *2*',
    ]);
  });

const actionFlow = addKeyword(['1', '2'])
  .addAnswer('Procesando...', null, async (ctx: any, { flowDynamic, state }: any) => {
    const action = ctx.body === '1' ? 'check_in' : 'check_out';
    const userPhone = ctx.from;
    const latitude = state.get('last_latitude');
    const longitude = state.get('last_longitude');

    if (!latitude || !longitude) {
      await flowDynamic(['❌ Error: No encontré tu ubicación.', 'Por favor envía tu ubicación actual de nuevo.']);
      return;
    }

    try {
      const response = await axios.post(
        `${BACKEND_API_URL}/api/attendance/validate`,
        { phone: userPhone, latitude, longitude, action },
        { headers: { Authorization: `Bearer ${BACKEND_API_SECRET}`, 'Content-Type': 'application/json' }, timeout: 10000 }
      );

      if (response.data.valid) {
        const { branch_name, time, hours_worked, message } = response.data;
        const lines = [
          message,
          '',
          `📍 *Sucursal:* ${branch_name}`,
          `🕐 *Hora:* ${new Date(time).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}`,
          hours_worked ? `⏱️ *Horas trabajadas:* ${hours_worked}` : '',
          '',
          '¡Que tengas un excelente día! 🎉',
        ].filter(Boolean);
        await flowDynamic(lines);
      } else {
        await flowDynamic([`❌ ${response.data.message}`, '', 'Si crees que esto es un error, contacta a tu empleador.']);
      }
    } catch (error: any) {
      await flowDynamic(['❌ Error al procesar tu solicitud.', 'Por favor intenta de nuevo en unos momentos.']);
    }
  });

const welcomeFlow = addKeyword(EVENTS.WELCOME)
  .addAnswer([
    '¡Hola! 👋',
    '',
    'Soy el asistente de *Timer*.',
    '',
    'Para marcar tu asistencia, envíame tu *ubicación actual*.',
    '',
    '📍 Toca el ícono + → Ubicación → Enviar mi ubicación actual',
  ]);

const fallbackFlow = addKeyword(['']).addAnswer([
  'No entendí tu mensaje.',
  '',
  'Para marcar asistencia, envía tu *ubicación actual*.',
  '',
  'Si necesitas ayuda, contacta a tu empleador.',
]);

const main = async () => {
  const adapterFlow = createFlow([locationFlow, actionFlow, welcomeFlow, fallbackFlow]);
  const adapterProvider = createProvider(Provider, {
    jwtToken: process.env.META_JWT_TOKEN,
    numberId: process.env.META_NUMBER_ID,
    verifyToken: process.env.META_VERIFY_TOKEN,
    version: process.env.META_API_VERSION || 'v22.0',
  });
  const adapterDB = new Database();

  const { handleCtx, httpServer } = await createBot({ flow: adapterFlow, provider: adapterProvider, database: adapterDB });

  adapterProvider.server.use(express.json());
  adapterProvider.server.use(express.urlencoded({ extended: true }));

  // Capture RAW payload for location validation (current vs fixed)
  adapterProvider.server.use((req:any , res:any, next:any) => {
    const payload = (req as any).body;
    if (req.method === 'POST' && payload?.entry?.[0]?.changes?.[0]?.value?.messages) {
      const messages = payload.entry[0].changes[0].value.messages;
      const locationMessages = messages.filter((m: any) => m.type === 'location');
      if (locationMessages.length > 0) {
        lastRawContext = payload;
      }
    }
    next();
  });

  adapterProvider.server.post('/v1/messages', handleCtx(async (bot: any, req: any, res: any) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || authHeader !== `Bearer ${BACKEND_API_SECRET}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const { number, message, urlMedia } = req.body;
    if (!number || !message) return res.status(400).json({ error: 'Missing required fields' });
    try {
      await bot.sendMessage(number, message, { media: urlMedia ?? null });
      return res.json({ success: true });
    } catch (e) {
      return res.status(500).json({ error: 'Failed to send message' });
    }
  }));

  adapterProvider.server.get('/health', (req: any, res: any) => {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ status: 'ok', service: 'builderbot-whatsapp' }));
  });

  httpServer(PORT);
  console.log(`🚀 BuilderBot running on port ${PORT}`);
};

main();


