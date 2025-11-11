import 'dotenv/config';
import { createBot, createProvider, createFlow, addKeyword, EVENTS, MemoryDB as Database } from '@builderbot/bot';
import { MetaProvider as Provider } from '@builderbot/provider-meta';
import axios from 'axios';
import express from 'express';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3008;
const BACKEND_API_URL = process.env.BACKEND_API_URL || 'http://localhost:3001';
const BACKEND_API_SECRET = process.env.BACKEND_API_SECRET || 'dev-secret';

let lastRawContext: any = null;
// Almacenamiento temporal de coordenadas por teléfono
// Usamos un Map en memoria ya que el state de BuilderBot puede no persistir entre flujos
const coordinatesCache = new Map<string, { latitude: number; longitude: number; timestamp: number }>();

const isCurrentLocation = (locationData: any) => {
  return !locationData?.address && !locationData?.name && !locationData?.url;
};

const locationFlow = addKeyword(EVENTS.LOCATION)
  .addAnswer('Procesando tu ubicación...', null, async (ctx: any, { flowDynamic, state }: any) => {
    console.log('\n📍 ===== LOCATION FLOW TRIGGERED =====');
    console.log('Context keys:', Object.keys(ctx));
    console.log('ctx.from:', ctx.from);
    console.log('ctx.latitude:', ctx.latitude);
    console.log('ctx.longitude:', ctx.longitude);
    console.log('lastRawContext:', lastRawContext ? 'EXISTS' : 'NULL');
    
    const userLatitude = ctx.latitude;
    const userLongitude = ctx.longitude;
    const userName = ctx.pushName || ctx.name || 'Usuario';
    // Normalizar el número de teléfono (remover el + si existe, mantener solo números)
    let userPhone = ctx.from;
    if (userPhone) {
      // Remover el + y cualquier espacio, mantener solo números
      userPhone = userPhone.replace(/[+\s]/g, '');
    }

    console.log(`📱 Phone normalizado: ${userPhone}`);

    // Validar que tenemos coordenadas
    if (!userLatitude || !userLongitude) {
      console.error('❌ No se encontraron coordenadas en el contexto');
      console.error('ctx completo:', JSON.stringify(ctx, null, 2));
      await flowDynamic([
        '❌ Error: No pude obtener tu ubicación.',
        'Por favor envía tu ubicación actual de nuevo.',
      ]);
      return;
    }

    console.log(`✅ Coordenadas recibidas: ${userLatitude}, ${userLongitude}`);

    // Guardar coordenadas en cache en memoria (más confiable que el state de BuilderBot)
    coordinatesCache.set(userPhone, {
      latitude: userLatitude,
      longitude: userLongitude,
      timestamp: Date.now()
    });
    console.log(`💾 Coordenadas guardadas en cache para ${userPhone}: ${userLatitude}, ${userLongitude}`);
    console.log(`📊 Cache size después de guardar: ${coordinatesCache.size}`);
    console.log(`📊 Cache keys después de guardar:`, Array.from(coordinatesCache.keys()));
    
    // También intentar guardar en state por si acaso
    try {
      if (state && state.update) {
        await state.update({ 
          [`${userPhone}_last_latitude`]: userLatitude, 
          [`${userPhone}_last_longitude`]: userLongitude, 
          [`${userPhone}_last_location_time`]: Date.now() 
        });
        console.log(`💾 Coordenadas también guardadas en state para ${userPhone}`);
      }
    } catch (e) {
      // Si falla, no es crítico, usamos el cache
      console.log(`⚠️ No se pudo guardar en state, usando cache: ${e}`);
    }

    // Verificar si es ubicación actual o fija
    const locationData = lastRawContext?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.location;
    const locationIsCurrentLocation = isCurrentLocation(locationData);

    console.log('Location data from raw context:', locationData);
    console.log('Is current location:', locationIsCurrentLocation);

    if (!locationIsCurrentLocation) {
      const fixed = locationData;
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
      console.log(`❌ Ubicación rechazada: ${userName} (${userPhone}) - Ubicación fija`);
      return;
    }

    console.log(`✅ Ubicación actual aceptada: ${userName} (${userPhone})`);

    // Procesar automáticamente sin pedir al usuario que elija
    // El backend determinará automáticamente si es check_in o check_out
    await flowDynamic(['Procesando...']);

    // Obtener coordenadas del cache
    const cached = coordinatesCache.get(userPhone);
    if (!cached) {
      await flowDynamic([
        '❌ Error: No encontré tu ubicación.',
        'Por favor envía tu ubicación actual de nuevo.',
      ]);
      return;
    }

    const { latitude, longitude } = cached;

    // Limpiar coordenadas del cache después de usarlas
    coordinatesCache.delete(userPhone);
    console.log(`🧹 Coordenadas eliminadas del cache después de usar para ${userPhone}`);

    try {
      // Construir la URL correctamente (evitar duplicar /api)
      let url = BACKEND_API_URL.trim();
      if (url.endsWith('/')) url = url.slice(0, -1);
      if (!url.endsWith('/api')) {
        url += '/api';
      }
      url += '/attendance/validate';

      // El backend espera el formato E.164 (con +), pero userPhone está normalizado sin +
      const phoneForApi = userPhone.startsWith('+') ? userPhone : `+${userPhone}`;

      console.log(`📡 Enviando request a: ${url}`);
      console.log(`📡 Payload:`, { phone: phoneForApi, latitude, longitude }); // Sin action, el backend lo determina

      const response = await axios.post(
        url,
        { phone: phoneForApi, latitude, longitude }, // No enviar action, el backend lo determina automáticamente
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
      console.error('Error al procesar la solicitud:', error);
      await flowDynamic(['❌ Error al procesar tu solicitud.', 'Por favor intenta de nuevo en unos momentos.']);
    }
  });

// actionFlow ya no es necesario, locationFlow procesa automáticamente
// Eliminamos este flujo para evitar conflictos

const welcomeFlow = addKeyword(EVENTS.WELCOME)
  .addAnswer('Procesando...', null, async (ctx: any, { flowDynamic }: any) => {
    await flowDynamic([
      '¡Hola! 👋',
      '',
      'Soy el asistente de *Timer*.',
      '',
      'Para marcar tu asistencia, envíame tu *ubicación actual*.',
      '',
      '📍 Toca el ícono + → Ubicación → Enviar mi ubicación actual',
    ]);
  });

// Fallback solo se activa si no hay otro flujo que coincida
// IMPORTANTE: No usar addKeyword(['']) porque captura todo
// En su lugar, usar un patrón que solo coincida con texto que no sea ubicación
// Fallback solo se activa con palabras clave específicas
// NO usar addKeyword(['']) porque captura todo, incluso sin mensaje
const fallbackFlow = addKeyword(['hola', 'adiós', 'adios', 'ayuda', 'help', 'info', 'información'])
  .addAnswer('Procesando...', null, async (ctx: any, { flowDynamic }: any) => {
    // Verificar que realmente haya un mensaje de texto
    if (ctx.type === 'text' && ctx.body && ctx.body.trim().length > 0) {
      await flowDynamic([
        'No entendí tu mensaje.',
        '',
        'Para marcar asistencia, envía tu *ubicación actual*.',
        '',
        '📍 Toca el ícono + → Ubicación → Enviar mi ubicación actual',
        '',
        'Si necesitas ayuda, contacta a tu empleador.',
      ]);
    }
  });

const main = async () => {
  // IMPORTANTE: El middleware procesa las ubicaciones directamente
  // Los flujos solo manejan mensajes de texto y eventos especiales
  // welcomeFlow debe ir antes de fallbackFlow
  // fallbackFlow debe ir al final
  const adapterFlow = createFlow([welcomeFlow, fallbackFlow]);
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

  // Logging reducido - solo mensajes importantes

  // Capture RAW payload for location validation (current vs fixed)
  // IMPORTANTE: Este middleware debe ejecutarse ANTES de que BuilderBot procese el evento
  adapterProvider.server.use(async (req: any, res: any, next: any) => {
    if (req.method === 'POST') {
      const payload = req.body;
      
      // Verificar si es un webhook de Meta con mensajes
      if (payload?.entry?.[0]?.changes?.[0]?.value?.messages) {
        const messages = payload.entry[0].changes[0].value.messages;
        const locationMessages = messages.filter((m: any) => m.type === 'location');
        
        if (locationMessages.length > 0) {
          // Guardar el contexto RAW ANTES de que BuilderBot lo procese
          lastRawContext = payload;
          
          // Procesar cada ubicación directamente aquí
          for (const msg of locationMessages) {
            const isCurrent = isCurrentLocation(msg.location);
            const phone = msg.from ? msg.from.replace(/[+\s]/g, '') : null;
            
            console.log(`📍 UBICACIÓN #${locationMessages.indexOf(msg) + 1}:`);
            console.log(`  ├─ From: ${msg.from}`);
            console.log(`  ├─ Latitude: ${msg.location.latitude}`);
            console.log(`  ├─ Longitude: ${msg.location.longitude}`);
            console.log(`  ├─ Type: ${isCurrent ? '✅ ACTUAL' : '❌ FIJA'}`);
            
            if (!isCurrent) {
              // Ubicación fija - rechazar inmediatamente
              console.log(`⚠️ [MIDDLEWARE] Ubicación fija detectada, rechazando...`);
              try {
                const META_API_VERSION = process.env.META_API_VERSION || 'v22.0';
                const META_JWT_TOKEN = process.env.META_JWT_TOKEN;
                const META_NUMBER_ID = process.env.META_NUMBER_ID;
                
                const rejectionMessage = [
                  '⚠️ *UBICACIÓN NO VÁLIDA*',
                  '',
                  '❌ Me estás enviando una ubicación guardada del mapa.',
                  '',
                  'No puedo verificar que realmente estés en el lugar.',
                  '',
                  '💡 *Para registrar tu asistencia:*',
                  '1️⃣ Toca el ícono de adjuntar (+)',
                  '2️⃣ Selecciona "Ubicación"',
                  '3️⃣ Elige "Enviar mi ubicación actual"',
                  '',
                  '¡Inténtalo de nuevo! 🙏',
                ].join('\n');
                
                await axios.post(
                  `https://graph.facebook.com/${META_API_VERSION}/${META_NUMBER_ID}/messages`,
                  {
                    messaging_product: 'whatsapp',
                    to: msg.from,
                    type: 'text',
                    text: { body: rejectionMessage },
                  },
                  {
                    headers: {
                      'Authorization': `Bearer ${META_JWT_TOKEN}`,
                      'Content-Type': 'application/json',
                    },
                  }
                );
                console.log(`❌ Mensaje de rechazo enviado a ${msg.from}`);
              } catch (error: any) {
                console.error('Error enviando mensaje de rechazo:', error.message);
              }
              continue; // Saltar al siguiente mensaje
            }
            
            // Ubicación actual - guardar y procesar
            if (phone && msg.location.latitude && msg.location.longitude) {
              coordinatesCache.set(phone, {
                latitude: msg.location.latitude,
                longitude: msg.location.longitude,
                timestamp: Date.now()
              });
              console.log(`💾 [MIDDLEWARE] Coordenadas guardadas en cache para ${phone}: ${msg.location.latitude}, ${msg.location.longitude}`);
              
              // Enviar mensaje de procesamiento inmediatamente
              try {
                const META_API_VERSION = process.env.META_API_VERSION || 'v22.0';
                const META_JWT_TOKEN = process.env.META_JWT_TOKEN;
                const META_NUMBER_ID = process.env.META_NUMBER_ID;
                
                await axios.post(
                  `https://graph.facebook.com/${META_API_VERSION}/${META_NUMBER_ID}/messages`,
                  {
                    messaging_product: 'whatsapp',
                    to: msg.from,
                    type: 'text',
                    text: { body: '⏳ Un momento, estamos procesando tu solicitud...' },
                  },
                  {
                    headers: {
                      'Authorization': `Bearer ${META_JWT_TOKEN}`,
                      'Content-Type': 'application/json',
                    },
                  }
                );
              } catch (processingMsgError: any) {
                console.error('Error enviando mensaje de procesamiento:', processingMsgError.message);
                // Continuar aunque falle el mensaje de procesamiento
              }
              
              // Procesar inmediatamente la ubicación actual
              try {
                let url = BACKEND_API_URL.trim();
                if (url.endsWith('/')) url = url.slice(0, -1);
                if (!url.endsWith('/api')) {
                  url += '/api';
                }
                url += '/attendance/validate';
                
                const phoneForApi = phone.startsWith('+') ? phone : `+${phone}`;
                
                console.log(`📡 [MIDDLEWARE] Procesando ubicación automáticamente para ${phoneForApi}`);
                
                const response = await axios.post(
                  url,
                  { phone: phoneForApi, latitude: msg.location.latitude, longitude: msg.location.longitude },
                  { headers: { Authorization: `Bearer ${BACKEND_API_SECRET}`, 'Content-Type': 'application/json' }, timeout: 10000 }
                );
                
                // Enviar respuesta al usuario
                const META_API_VERSION = process.env.META_API_VERSION || 'v22.0';
                const META_JWT_TOKEN = process.env.META_JWT_TOKEN;
                const META_NUMBER_ID = process.env.META_NUMBER_ID;
                
                if (response.data.valid) {
                  const { branch_name, time, timezone, hours_worked, time_worked_formatted, message } = response.data;
                  
                  // Formatear hora usando timezone de la sucursal
                  const branchTimezone = timezone || 'America/Mexico_City';
                  // Usar dayjs para manejar correctamente el timezone
                  // Asegurar que se interprete como UTC primero, luego convertir al timezone de la sucursal
                  const timeObj = dayjs.utc(time).tz(branchTimezone);
                  const formattedTime = timeObj.format('hh:mm A');
                  
                  const lines = [
                    message,
                    '',
                    `📍 *Sucursal:* ${branch_name}`,
                    `🕐 *Hora:* ${formattedTime}`,
                    time_worked_formatted ? `⏱️ *Tiempo trabajado:* ${time_worked_formatted}` : '',
                    '',
                    '¡Que tengas un excelente día! 🎉',
                  ].filter(Boolean).join('\n');
                  
                  await axios.post(
                    `https://graph.facebook.com/${META_API_VERSION}/${META_NUMBER_ID}/messages`,
                    {
                      messaging_product: 'whatsapp',
                      to: msg.from,
                      type: 'text',
                      text: { body: lines },
                    },
                    {
                      headers: {
                        'Authorization': `Bearer ${META_JWT_TOKEN}`,
                        'Content-Type': 'application/json',
                      },
                    }
                  );
                } else {
                  await axios.post(
                    `https://graph.facebook.com/${META_API_VERSION}/${META_NUMBER_ID}/messages`,
                    {
                      messaging_product: 'whatsapp',
                      to: msg.from,
                      type: 'text',
                      text: { body: `❌ ${response.data.message}\n\nSi crees que esto es un error, contacta a tu empleador.` },
                    },
                    {
                      headers: {
                        'Authorization': `Bearer ${META_JWT_TOKEN}`,
                        'Content-Type': 'application/json',
                      },
                    }
                  );
                }
                
                // Limpiar coordenadas del cache después de usar
                coordinatesCache.delete(phone);
                console.log(`🧹 Coordenadas eliminadas del cache después de procesar para ${phone}`);
              } catch (error: any) {
                console.error('Error procesando ubicación en middleware:', error.message);
                try {
                  const META_API_VERSION = process.env.META_API_VERSION || 'v22.0';
                  const META_JWT_TOKEN = process.env.META_JWT_TOKEN;
                  const META_NUMBER_ID = process.env.META_NUMBER_ID;
                  
                  await axios.post(
                    `https://graph.facebook.com/${META_API_VERSION}/${META_NUMBER_ID}/messages`,
                    {
                      messaging_product: 'whatsapp',
                      to: msg.from,
                      type: 'text',
                      text: { body: '❌ Error al procesar tu solicitud.\nPor favor intenta de nuevo en unos momentos.' },
                    },
                    {
                      headers: {
                        'Authorization': `Bearer ${META_JWT_TOKEN}`,
                        'Content-Type': 'application/json',
                      },
                    }
                  );
                } catch (sendError: any) {
                  console.error('Error enviando mensaje de error:', sendError.message);
                }
              }
            }
          }
        }
      }
    }
    next();
  });

  // Endpoint para enviar mensajes usando la API de Meta directamente
  // NOTA: Este endpoint NO usa bot.sendMessage() porque MetaProvider usa la API de Meta,
  // no Baileys (WhatsApp Web). Para mensajes simples, usamos la API de Meta directamente.
  adapterProvider.server.post('/v1/messages', async (req: any, res: any) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || authHeader !== `Bearer ${BACKEND_API_SECRET}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    const { number, message, buttonUrl, buttonText } = req.body;
    if (!number || !message) {
      return res.status(400).json({ error: 'Missing required fields: number and message are required' });
    }
    
    try {
      // Usar la API de Meta directamente para enviar mensajes
      const META_API_VERSION = process.env.META_API_VERSION || 'v22.0';
      const META_JWT_TOKEN = process.env.META_JWT_TOKEN;
      const META_NUMBER_ID = process.env.META_NUMBER_ID;
      
      if (!META_JWT_TOKEN || !META_NUMBER_ID) {
        return res.status(500).json({ error: 'META_JWT_TOKEN y META_NUMBER_ID deben estar configurados' });
      }
      
      const url = `https://graph.facebook.com/${META_API_VERSION}/${META_NUMBER_ID}/messages`;
      
      // Construir el payload según si tiene botón o no
      let payload: any = {
        messaging_product: 'whatsapp',
        to: number,
        type: 'text',
        text: {
          body: message,
        },
      };
      
      // Si hay botón, agregar botones interactivos
      if (buttonUrl && buttonText) {
        payload.type = 'interactive';
        payload.interactive = {
          type: 'button',
          body: {
            text: message,
          },
          action: {
            buttons: [
              {
                type: 'url',
                url: buttonUrl,
                title: buttonText,
              },
            ],
          },
        };
      }
      
      console.log(`📤 [BUILDERBOT] Enviando mensaje a ${number}`);
      console.log(`📤 [BUILDERBOT] Payload:`, JSON.stringify(payload, null, 2));
      
      const response = await axios.post(url, payload, {
        headers: {
          'Authorization': `Bearer ${META_JWT_TOKEN}`,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      });
      
      console.log(`✅ [BUILDERBOT] Mensaje enviado exitosamente`);
      console.log(`📨 [BUILDERBOT] Message ID: ${response.data.messages?.[0]?.id}`);
      
      return res.json({ 
        success: true, 
        messageId: response.data.messages?.[0]?.id 
      });
    } catch (error: any) {
      console.error('❌ [BUILDERBOT] Error al enviar mensaje:', error.response?.data || error.message);
      return res.status(500).json({ 
        error: 'Failed to send message',
        details: error.response?.data?.error?.message || error.message 
      });
    }
  });

  adapterProvider.server.get('/health', (req: any, res: any) => {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ status: 'ok', service: 'builderbot-whatsapp' }));
  });

  httpServer(PORT);
  console.log(`🚀 BuilderBot running on port ${PORT}`);
};

main();


