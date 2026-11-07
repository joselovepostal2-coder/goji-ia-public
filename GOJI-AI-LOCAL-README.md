# GOJI AI local para Windows

## Requisitos
- Windows 10/11.
- Node.js 20 o superior (incluye npm).
- Conexión a internet para consultar Abacus RouteLLM.

## Iniciar
1. Descarga este repositorio como ZIP desde GitHub y extrae la carpeta.
2. Instala Node.js 20 o superior desde https://nodejs.org/ si aún no está instalado.
3. Abre `INICIAR-GOJI-AI-LOCAL.bat`.
4. Se abrirá GOJI AI en `http://127.0.0.1:3000`. Mantén abierta la ventana negra mientras lo uses.
5. Entra en **GOJI AI Hub**, pega una clave válida de Abacus RouteLLM y pulsa **Guardar clave en este PC**.
6. Pulsa **Comprobar clave y cargar modelos**. Después selecciona Abacus en el chat y elige un modelo del catálogo.

## Seguridad y límites
- El servidor escucha únicamente en `127.0.0.1`; no está publicado en internet ni en tu red local.
- La clave se guarda en `.goji-local.json`, dentro de esta carpeta. Ese archivo está excluido de Git por `.gitignore`; no lo compartas ni lo subas.
- La clave no se envía a Render. Render queda intacto como respaldo independiente.
- La clave debe tener acceso a RouteLLM. Una clave de otro producto Abacus podría no servir.
- El catálogo refleja los modelos que Abacus permite a esa cuenta. El plan, saldo, cuotas y permisos determinan qué se puede usar. GOJI AI no desbloquea modelos ni elimina límites.
- Esta versión local activa Abacus RouteLLM. Los proveedores directos OpenAI, Anthropic, Gemini y DeepSeek siguen disponibles en la versión Render, no en el servidor local de este primer paso.
- El uso de API puede consumir saldo o generar cargos según la cuenta. No añadas métodos de pago ni actives facturación sin autorización de un adulto responsable.

## Detener
Cierra la ventana negra o pulsa `Ctrl+C`. GOJI AI dejará de estar disponible hasta que vuelvas a ejecutar el `.bat`.

## Copias
Tus proyectos y datos de GOJI AI se guardan en el almacenamiento del navegador. Usa **Archivo y copias → Exportar copia** para respaldarlos. El archivo `.goji-local.json` contiene tu clave local; mantenlo privado.
