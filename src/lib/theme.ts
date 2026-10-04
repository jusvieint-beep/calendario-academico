/** Script que aplica el tema guardado antes de pintar (evita parpadeo). */
export const themeInitScript =
  "try{var t=localStorage.getItem('cal-theme');if(t==='dark'||t==='light')document.documentElement.dataset.theme=t;}catch(e){}";
