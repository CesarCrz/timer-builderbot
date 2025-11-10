# Guía de Debugging - BuilderBot Location Flow

## Problemas Comunes y Soluciones

### Problema 1: "No encontré tu ubicación" después de enviar ubicación

**Síntomas:**
- Usuario envía ubicación
- Bot responde "Procesando..."
- Usuario responde "1" o "2"
- Bot responde "Error: No encontré tu ubicación"

**Causas posibles:**
1. El estado no persiste entre mensajes
2. Las coordenadas no se guardan correctamente
3. El middleware no captura el payload antes de que BuilderBot lo procese

**Solución implementada:**
- Usar clave única basada en número de teléfono: `${userPhone}_last_latitude`
- Agregar logs detallados para debugging
- Verificar que `lastRawContext` se capture antes del procesamiento

### Problema 2: Ubicación fija no se detecta correctamente

**Síntomas:**
- Usuario envía ubicación guardada del mapa
- Bot no la rechaza y trata de procesarla

**Solución:**
- Verificar que `lastRawContext` contenga los datos de ubicación
- La función `isCurrentLocation` verifica: `!address && !name && !url`

## Logs de Debugging

El código ahora incluye logs detallados:

1. **RAW PAYLOAD**: Se imprime cuando se recibe un mensaje de ubicación
2. **LOCATION FLOW**: Se imprime cuando se activa el flujo de ubicación
3. **ACTION FLOW**: Se imprime cuando el usuario responde "1" o "2"
4. **Estado completo**: Se imprime si no se encuentran coordenadas

## Verificación del Estado

Para verificar que el estado funciona:

1. Envía una ubicación
2. Revisa los logs para ver si se guardó: `✅ Coordenadas recibidas: X, Y`
3. Responde "1" o "2"
4. Revisa los logs para ver si se recuperó: `Coordinates from state: X, Y`

## Alternativa: Usar Base de Datos Temporal

Si el estado de BuilderBot no persiste, se puede usar una tabla temporal en Supabase o Redis para guardar las coordenadas con un TTL de 5 minutos.

