# Hear Me Out Cake 🎂

Mini app colaborativa para hacer un Hear Me Out Cake con amigos en tiempo real, sin cuentas ni base de datos propia.

## Qué hace

- Crea salas de 6 caracteres.
- Los invitados solo escriben su nombre.
- Sin registro, email ni contraseña.
- Cada persona añade una foto + nombre.
- Cada persona puede mover y quitar sus propias fotos.
- El host ve y retransmite el estado a todos.
- Al finalizar, el host puede descargar:
  - Un reporte `.html` con qué puso cada participante y sus imágenes.
  - Un archivo `.json` con los datos completos de la partida.
- Las imágenes se reducen en el navegador antes de enviarse.

## Tecnología

- HTML
- CSS
- JavaScript
- PeerJS / WebRTC
- GitHub Pages

PeerJS usa su PeerServer Cloud gratuito para señalización. Después, los navegadores intercambian los datos mediante WebRTC.

## Publicarlo en GitHub Pages

1. Crea un repositorio nuevo en GitHub, por ejemplo:
   `hear-me-out-cake`
2. Sube estos archivos a la raíz:
   - `index.html`
   - `style.css`
   - `app.js`
3. En el repositorio entra a:
   **Settings → Pages**
4. En **Build and deployment**, selecciona:
   - Source: `Deploy from a branch`
   - Branch: `main`
   - Folder: `/ (root)`
5. Guarda.
6. GitHub te mostrará la URL de tu página.

Ejemplo:

`https://TU-USUARIO.github.io/hear-me-out-cake/`

## Importante

Esta versión es deliberadamente "sin backend propio":

- El host debe mantener la pestaña abierta.
- Si el host cierra la página, la sala termina.
- La partida no queda guardada en la nube.
- El reporte debe descargarse antes de cerrar la pestaña.
- PeerJS Cloud es un servicio público compartido.
- Algunas redes muy restrictivas pueden impedir conexiones WebRTC directas; un servidor TURN sería necesario para máxima compatibilidad.

## Privacidad

Las fotos se convierten a datos dentro del navegador y se envían durante la partida. Esta app no configura una base de datos ni almacenamiento persistente.

## Personalización rápida

En `index.html` puedes cambiar:
- El nombre de la app.
- Los textos.
- Los botones.

En `style.css` puedes cambiar todo el aspecto visual.

En `app.js` está la lógica de:
- salas
- participantes
- sincronización
- fotos
- drag
- exportación del reporte
