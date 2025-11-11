# Configuración del Webhook de Meta para BuilderBot

## Problema Común: "You must first log in by scanning the qr code"

Este error ocurre cuando se intenta usar `bot.sendMessage()` con MetaProvider. **MetaProvider NO usa Baileys (WhatsApp Web)**, usa la API de Meta directamente, por lo que NO requiere escanear QR.

## Solución Implementada

El endpoint `/v1/messages` ahora usa la API de Meta directamente en lugar de `bot.sendMessage()`.

## Configuración del Webhook en Meta Business Manager

Para que BuilderBot reciba mensajes entrantes, necesitas configurar el webhook en Meta:

### 1. Obtener la URL del Webhook

Si estás usando ngrok:
```bash
ngrok http 3008
```

Tu URL será algo como: `https://xxxx-xxxx-xxxx.ngrok.io`

### 2. Configurar en Meta Business Manager

1. Ve a [Meta Business Manager](https://business.facebook.com)
2. Selecciona tu cuenta de negocio
3. Ve a **WhatsApp** > **API Setup** o **Configuración de API**
4. En la sección **Webhook**, haz clic en **Configurar Webhooks**
5. Ingresa:
   - **Callback URL**: `https://tu-ngrok-url.ngrok.io/webhook` (o la ruta que MetaProvider espera)
   - **Verify Token**: El mismo valor que tienes en `META_VERIFY_TOKEN` en tu `.env`
6. Selecciona los campos de suscripción:
   - ✅ `messages`
   - ✅ `message_status`
   - ✅ `message_deliveries`
   - ✅ `message_reads`
7. Haz clic en **Verificar y Guardar**

### 3. Verificar que el Webhook Funciona

El endpoint de verificación debería responder automáticamente. Si no funciona, verifica:

1. **META_VERIFY_TOKEN** en tu `.env` debe coincidir con el que configuraste en Meta
2. El servidor debe estar corriendo y accesible desde internet (usando ngrok o similar)
3. El puerto debe ser el correcto (3008 por defecto)

## Endpoints Disponibles

### POST /v1/messages
Envía mensajes usando la API de Meta directamente.

**Headers:**
```
Authorization: Bearer {BACKEND_API_SECRET}
Content-Type: application/json
```

**Body:**
```json
{
  "number": "+5213326232840",
  "message": "Tu mensaje aquí",
  "buttonUrl": "https://timer.app/invite/token", // Opcional
  "buttonText": "Unirme" // Opcional, requiere buttonUrl
}
```

**Response:**
```json
{
  "success": true,
  "messageId": "wamid.xxxxx"
}
```

### GET /webhook
Endpoint de verificación de Meta (manejado automáticamente por MetaProvider).

### POST /webhook
Endpoint que recibe los webhooks de Meta (manejado automáticamente por MetaProvider).

### GET /health
Health check del servicio.

## Debugging

### Ver Logs de Mensajes Entrantes

Los logs ahora muestran:
- `📥 [WEBHOOK]` - Todos los requests recibidos
- `📨 [WEBHOOK]` - Mensajes recibidos
- `📍 UBICACIÓN` - Ubicaciones recibidas
- `📊 [WEBHOOK]` - Estados de mensajes

### Verificar que Meta Está Enviando Webhooks

1. Envía un mensaje a tu número de WhatsApp Business
2. Revisa los logs de BuilderBot
3. Deberías ver `📥 [WEBHOOK] POST /webhook` o similar

### Problemas Comunes

1. **No recibo mensajes entrantes:**
   - Verifica que el webhook esté configurado en Meta
   - Verifica que la URL sea accesible desde internet
   - Verifica que `META_VERIFY_TOKEN` coincida

2. **Error 401 en /v1/messages:**
   - Verifica que el header `Authorization: Bearer {BACKEND_API_SECRET}` sea correcto
   - Verifica que `BACKEND_API_SECRET` en `.env` coincida

3. **Error al enviar mensajes:**
   - Verifica que `META_JWT_TOKEN` y `META_NUMBER_ID` estén configurados
   - Verifica que el token tenga permisos para enviar mensajes

## Variables de Entorno Requeridas

```env
PORT=3008
BACKEND_API_URL=http://localhost:3001
BACKEND_API_SECRET=tu-secret-aqui
META_JWT_TOKEN=tu-token-de-meta
META_NUMBER_ID=tu-number-id
META_VERIFY_TOKEN=tu-verify-token
META_API_VERSION=v22.0
```

