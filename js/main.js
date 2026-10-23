/* =========================================================
   AMAIS FÁCIL — interações e animações de scroll
   Sem dependências. Tudo roda em um único rAF.
   ========================================================= */
(function () {
  'use strict';

  var $  = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var isMobile = function () { return window.matchMedia('(max-width: 900px)').matches; };

  var clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };
  var clamp01 = function (v) { return clamp(v, 0, 1); };
  var lerp = function (a, b, t) { return a + (b - a) * t; };
  /* easeInOutCubic — dá o peso de "objeto pesado" ao voo do cartão */
  var ease = function (t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };

  /* proporção real do cartão (4096 × 2562 do render oficial) */
  var CARD_RATIO = 1.5988;

  /* =======================================================
     1. Header
     ======================================================= */
  var header = $('.site-header');
  var burger = $('#burger');
  var drawer = $('#mobile-menu');

  function setStuck(y) {
    header.classList.toggle('is-stuck', y > 40);
  }

  function closeDrawer() {
    if (!drawer || drawer.hidden) return;
    drawer.classList.remove('is-open');
    burger.setAttribute('aria-expanded', 'false');
    burger.setAttribute('aria-label', 'Abrir menu');
    document.body.classList.remove('menu-open');
    window.setTimeout(function () { drawer.hidden = true; }, 380);
  }

  function openDrawer() {
    drawer.hidden = false;
    /* força reflow para a transição de entrada rodar */
    void drawer.offsetWidth;
    drawer.classList.add('is-open');
    burger.setAttribute('aria-expanded', 'true');
    burger.setAttribute('aria-label', 'Fechar menu');
    document.body.classList.add('menu-open');
  }

  if (burger) {
    burger.addEventListener('click', function () {
      if (burger.getAttribute('aria-expanded') === 'true') closeDrawer();
      else openDrawer();
    });
  }
  if (drawer) {
    drawer.addEventListener('click', function (e) {
      if (e.target.tagName === 'A') closeDrawer();
    });
  }
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeDrawer();
  });

  /* =======================================================
     2. Helpers de geometria
     ======================================================= */

  /* Onde a imagem realmente cai na tela depois do object-fit:cover */
  function coverBox(img) {
    var box = img.getBoundingClientRect();
    var nw = img.naturalWidth, nh = img.naturalHeight;
    if (!nw || !nh || !box.width) return null;

    var scale = Math.max(box.width / nw, box.height / nh);
    var dw = nw * scale, dh = nh * scale;

    var op = window.getComputedStyle(img).objectPosition.split(/\s+/);
    var px = pct(op[0], 0.5), py = pct(op[1], 0.5);

    return {
      ox: box.left + (box.width - dw) * px,
      oy: box.top + (box.height - dh) * py,
      dw: dw, dh: dh
    };
  }

  /* Retângulo (viewport) de uma fração da imagem quando ela usa object-fit:cover */
  function coverFrac(img, f) {
    var c = coverBox(img);
    if (!c) return null;
    return { cx: c.ox + f.cx * c.dw, cy: c.oy + f.cy * c.dh, h: f.h * c.dh };
  }

  function pct(v, fallback) {
    if (!v) return fallback;
    if (v.indexOf('%') > -1) return parseFloat(v) / 100;
    if (v === 'left' || v === 'top') return 0;
    if (v === 'right' || v === 'bottom') return 1;
    if (v === 'center') return 0.5;
    return fallback;
  }

  /* Retângulo (viewport) de uma fração de um elemento renderizado inteiro */
  function boxFrac(el, f) {
    var b = el.getBoundingClientRect();
    if (!b.width) return null;
    return { cx: b.left + f.cx * b.width, cy: b.top + f.cy * b.height, h: f.h * b.height };
  }

  /* Alvo a partir de um slot vazio do layout */
  function slotTarget(el, heightRatio) {
    var b = el.getBoundingClientRect();
    if (!b.width) return null;
    return { cx: b.left + b.width / 2, cy: b.top + b.height / 2, h: b.height * (heightRatio || 1) };
  }

  function docTop(el) {
    return el.getBoundingClientRect().top + window.scrollY;
  }

  /* =======================================================
     3. Cartão voador — genérico
     ======================================================= */
  function FlyCard(el) {
    this.el = el;
    this.inner = el.firstElementChild;
    this.img = el.querySelector('img');
    this.ready = false;
    var self = this;
    if (this.img.complete && this.img.naturalWidth) this.ready = true;
    else this.img.addEventListener('load', function () { self.ready = true; measure(); });
  }

  FlyCard.prototype.place = function (t, rot) {
    if (!t) { this.el.classList.remove('is-live'); return; }
    var h = t.h;
    var w = h * CARD_RATIO;
    this.el.style.width = w + 'px';
    this.el.style.height = h + 'px';
    this.el.style.transform =
      'translate3d(' + (t.cx - w / 2) + 'px,' + (t.cy - h / 2) + 'px,0)';
    this.inner.style.transform =
      'rotateX(' + rot.rx + 'deg) rotateY(' + rot.ry + 'deg) rotateZ(' + rot.rz + 'deg)';
    this.el.classList.add('is-live');
  };

  function lerpTarget(a, b, t) {
    if (!a) return b;
    if (!b) return a;
    return { cx: lerp(a.cx, b.cx, t), cy: lerp(a.cy, b.cy, t), h: lerp(a.h, b.h, t) };
  }
  function lerpRot(a, b, t) {
    return { rx: lerp(a.rx, b.rx, t), ry: lerp(a.ry, b.ry, t), rz: lerp(a.rz, b.rz, t) };
  }

  /* --- Frações medidas nas fotos originais --- */

  /* onde a silhueta da modelo começa, na faixa vertical do título/parágrafo
     (hero-woman.webp 2383×1341) — usado para limitar a largura do texto */
  var HERO_SILHOUETTE_X = 0.50;
  var HERO_TEXT_GAP = 44;

  /* cartão na mão da modelo — cada recorte tem sua própria fração.
     desktop: hero-woman.webp 2383×1341 · mobile: hero-woman-mobile.webp 2383×1530 */
  var HERO_F_DESKTOP = { cx: 0.72410, cy: 0.34340, h: 0.034676 };
  var HERO_F_MOBILE  = { cx: 0.72410, cy: 0.42451, h: 0.030392 };
  var HERO_ROT = { rx: 0, ry: 0, rz: -6.2 };

  /* o <picture> troca o arquivo no breakpoint; a altura natural diz qual está ativo */
  function heroFrac() {
    return heroPhoto && heroPhoto.naturalHeight > 1450 ? HERO_F_MOBILE : HERO_F_DESKTOP;
  }

  /* buraco recortado em hand-card-2.png (916×902) */
  var HAND_B_F = { cx: 0.29967, cy: 0.36973, h: 0.32927 };

  var FLAT_ROT = { rx: 0, ry: 0, rz: 0 };
  /* pose 3D final, equivalente ao render inclinado do Figma */
  var TILT_ROT = { rx: 32, ry: -22, rz: -13 };
  /* cartão em pé ao lado do celular, na seção de parceiros */
  var PHONE_ROT = { rx: 4, ry: -22, rz: -13 };

  /* =======================================================
     4. Estado medido (recalculado em resize / load)
     ======================================================= */
  var heroPhoto = $('#heroPhoto');
  var slotFlat  = $('#slotFlat');
  var slotTilt  = $('#slotTilt');
  var slotPhone = $('#slotPhoneCard');
  var heroFg    = $('#heroFg');
  var handB     = $('#handB');
  var ctaSec    = $('.cta');
  var ecoEnd    = $('.eco__end');
  var ecoCards  = $$('.eco-card');

  var flyA = slotFlat ? new FlyCard($('#flyA')) : null;
  var flyB = slotPhone ? new FlyCard($('#flyB')) : null;

  var M = {};   /* marcos em coordenadas de documento */

  /* Limita o texto da hero para ele nunca alcançar a modelo.
     Como a foto é object-fit:cover, a silhueta muda de lugar conforme a
     proporção da janela — por isso a largura é medida, não chutada. */
  var heroInner = $('.hero__inner');
  var heroEl = $('.hero');

  function heroSafe() {
    if (!heroEl || !heroPhoto || !heroInner) return;
    if (isMobile()) { heroEl.style.removeProperty('--hero-safe'); return; }

    var c = coverBox(heroPhoto);
    if (!c) return;
    var left = heroInner.getBoundingClientRect().left;
    var safe = c.ox + HERO_SILHOUETTE_X * c.dw - left - HERO_TEXT_GAP;
    heroEl.style.setProperty('--hero-safe', Math.max(320, safe) + 'px');
  }

  /* Sobrepõe a ponta dos dedos exatamente em cima da foto da hero, acima do
     cartão animado — é o que faz a mão parecer realmente segurar o cartão. */
  var heroFgImg = heroFg ? heroFg.querySelector('img') : null;

  function placeHeroFg() {
    if (!heroFg || !heroFgImg || !heroFgImg.naturalWidth) return;
    var c = coverBox(heroPhoto);
    if (!c) return;
    heroFgImg.style.width = c.dw + 'px';
    heroFgImg.style.height = c.dh + 'px';
    heroFgImg.style.transform = 'translate3d(' + c.ox + 'px,' + c.oy + 'px,0)';
    heroFg.classList.add('is-live');
  }

  function measure() {
    var vh = window.innerHeight;
    heroSafe();

    if (slotFlat && slotTilt) {
      M.a0 = vh * 0.16;
      M.a1 = docTop(slotFlat) + slotFlat.offsetHeight / 2 - vh / 2;
      M.b1 = docTop(slotTilt) + slotTilt.offsetHeight / 2 - vh / 2;
      if (M.a1 <= M.a0) M.a1 = M.a0 + 1;
      if (M.b1 <= M.a1) M.b1 = M.a1 + 1;
    }

    if (slotPhone && handB && ctaSec) {
      M.c0 = docTop(ctaSec) - vh;
      M.c1 = docTop(handB) + handB.offsetHeight * HAND_B_F.cy - vh / 2;
      if (M.c1 <= M.c0) M.c1 = M.c0 + 1;
    }
  }

  /* =======================================================
     5. Loop de scroll
     ======================================================= */
  function frame() {
    var y = window.scrollY;
    var mobile = isMobile();

    setStuck(y);
    placeHeroFg();

    /* ---- A. cartão hero → seção 2 → pose 3D ---- */
    if (flyA && flyA.ready && M.a1 != null) {
      var heroT = coverFrac(heroPhoto, heroFrac());
      var flatT = slotTarget(slotFlat, 1);
      var tiltT = slotTarget(slotTilt, 0.74);

      var target, rot;
      if (y <= M.a1) {
        var ta = ease(clamp01((y - M.a0) / (M.a1 - M.a0)));
        target = lerpTarget(heroT, flatT, ta);
        rot = lerpRot(HERO_ROT, FLAT_ROT, ta);
      } else {
        var tb = ease(clamp01((y - M.a1) / (M.b1 - M.a1)));
        target = lerpTarget(flatT, tiltT, tb);
        rot = lerpRot(FLAT_ROT, TILT_ROT, tb);
      }
      flyA.place(target, rot);
    }

    /* ---- B. cartão desce da penúltima para a última seção ---- */
    if (flyB && flyB.ready && M.c1 != null) {
      var aT = slotTarget(slotPhone, 0.82);
      var bT = boxFrac(handB, HAND_B_F);
      var tc = ease(clamp01((y - M.c0) / (M.c1 - M.c0)));
      flyB.place(lerpTarget(aT, bT, tc), lerpRot(PHONE_ROT, FLAT_ROT, tc));
    }

    /* ---- C. escala decrescente da pilha sticky (mobile) ---- */
    if (mobile && !reduced && ecoCards.length) {
      for (var i = 0; i < ecoCards.length; i++) {
        var c = ecoCards[i];
        var top = c.getBoundingClientRect().top;
        var stick = parseFloat(window.getComputedStyle(c).top) || 96;
        var over = clamp01((stick - top + 40) / 260);
        c.style.transform = 'scale(' + (1 - over * 0.06).toFixed(4) + ')';
        c.style.filter = over > 0 ? 'brightness(' + (1 - over * 0.18).toFixed(3) + ')' : '';
      }
    } else if (ecoCards.length) {
      for (var j = 0; j < ecoCards.length; j++) {
        ecoCards[j].style.transform = '';
        ecoCards[j].style.filter = '';
      }
    }

    ticking = false;
  }

  var ticking = false;
  function request() {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(frame);
  }

  /* posiciona os cartões sem animar quando o usuário pede menos movimento */
  function staticPlace() {
    if (flyA && flyA.ready) flyA.place(slotTarget(slotFlat, 1), FLAT_ROT);
    if (flyB && flyB.ready) flyB.place(boxFrac(handB, HAND_B_F), FLAT_ROT);
    placeHeroFg();
    setStuck(window.scrollY);
  }

  window.addEventListener('scroll', reduced ? function () { setStuck(window.scrollY); } : request, { passive: true });
  window.addEventListener('resize', function () {
    measure();
    reduced ? staticPlace() : request();
  });
  window.addEventListener('orientationchange', function () {
    window.setTimeout(function () { measure(); reduced ? staticPlace() : request(); }, 250);
  });

  /* =======================================================
     6. Reveal + CTA final da pilha
     ======================================================= */
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); }
      });
    }, { rootMargin: '0px 0px -12% 0px' });
    $$('[data-reveal]').forEach(function (el) { io.observe(el); });

    if (ecoEnd && ecoCards.length) {
      var last = ecoCards[ecoCards.length - 1];
      var io2 = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) { ecoEnd.classList.toggle('is-in', e.intersectionRatio > 0.5); });
      }, { threshold: [0, 0.5, 1] });
      io2.observe(last);
    }
  } else {
    /* sem IntersectionObserver nada pode ficar invisível */
    $$('[data-reveal]').forEach(function (el) { el.classList.add('is-in'); });
    if (ecoEnd) ecoEnd.classList.add('is-in');
  }

  /* =======================================================
     7. Formulário — máscaras e validação
     ======================================================= */
  var form = $('#propostaForm');

  function onlyDigits(v) { return v.replace(/\D+/g, ''); }

  function maskCNPJ(v) {
    v = onlyDigits(v).slice(0, 14);
    if (v.length > 12) return v.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{1,2})/, '$1.$2.$3/$4-$5');
    if (v.length > 8)  return v.replace(/(\d{2})(\d{3})(\d{3})(\d{1,4})/, '$1.$2.$3/$4');
    if (v.length > 5)  return v.replace(/(\d{2})(\d{3})(\d{1,3})/, '$1.$2.$3');
    if (v.length > 2)  return v.replace(/(\d{2})(\d{1,3})/, '$1.$2');
    return v;
  }

  function maskPhone(v) {
    v = onlyDigits(v).slice(0, 11);
    if (v.length > 10) return v.replace(/(\d{2})(\d{5})(\d{1,4})/, '($1) $2-$3');
    if (v.length > 6)  return v.replace(/(\d{2})(\d{4})(\d{1,4})/, '($1) $2-$3');
    if (v.length > 2)  return v.replace(/(\d{2})(\d{1,5})/, '($1) $2');
    if (v.length)      return v.replace(/(\d{1,2})/, '($1');
    return v;
  }

  function validCNPJ(v) {
    var c = onlyDigits(v);
    if (c.length !== 14 || /^(\d)\1{13}$/.test(c)) return false;
    function dv(len) {
      var sum = 0, pos = len - 7;
      for (var i = 0; i < len; i++) {
        sum += parseInt(c[i], 10) * pos--;
        if (pos < 2) pos = 9;
      }
      var r = sum % 11;
      return r < 2 ? 0 : 11 - r;
    }
    return dv(12) === parseInt(c[12], 10) && dv(13) === parseInt(c[13], 10);
  }

  var RULES = {
    nome: function (v) {
      var parts = v.trim().split(/\s+/).filter(Boolean);
      if (parts.length < 2) return 'Informe nome e sobrenome.';
      if (v.trim().length < 5) return 'Nome muito curto.';
      return '';
    },
    cnpj: function (v) { return validCNPJ(v) ? '' : 'CNPJ inválido.'; },
    telefone: function (v) {
      var d = onlyDigits(v);
      if (d.length < 10 || d.length > 11) return 'Informe DDD + número.';
      return '';
    },
    email: function (v) {
      return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(v.trim()) ? '' : 'E-mail inválido.';
    }
  };

  function setError(input, msg) {
    var slot = input.closest('.field') ? input.closest('.field').querySelector('[data-err]') : null;
    if (slot) slot.textContent = msg;
    input.setAttribute('aria-invalid', msg ? 'true' : 'false');
    return !msg;
  }

  if (form) {
    var cnpj = $('#cnpj'), tel = $('#telefone');
    cnpj.addEventListener('input', function () { cnpj.value = maskCNPJ(cnpj.value); });
    tel.addEventListener('input', function () { tel.value = maskPhone(tel.value); });

    Object.keys(RULES).forEach(function (name) {
      var input = form.elements[name];
      if (!input) return;
      input.addEventListener('blur', function () {
        if (input.value) setError(input, RULES[name](input.value));
      });
      input.addEventListener('input', function () {
        if (input.getAttribute('aria-invalid') === 'true') setError(input, RULES[name](input.value));
      });
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var ok = true, first = null;

      Object.keys(RULES).forEach(function (name) {
        var input = form.elements[name];
        if (!input) return;
        var msg = RULES[name](input.value);
        if (!setError(input, msg)) { ok = false; if (!first) first = input; }
      });

      var lgpd = form.elements.lgpd;
      var lgpdErr = $('[data-for="lgpd"]');
      if (!lgpd.checked) {
        ok = false;
        if (lgpdErr) lgpdErr.textContent = 'É preciso aceitar a Política de Privacidade para continuar.';
        if (!first) first = lgpd;
      } else if (lgpdErr) {
        lgpdErr.textContent = '';
      }

      var status = $('#formStatus');
      if (!ok) {
        status.textContent = 'Confira os campos destacados antes de enviar.';
        status.className = 'form__status is-err';
        if (first) first.focus();
        return;
      }

      /* Netlify Forms: o formulário "proposta" é detectado no index.html a cada deploy. */
      var payload = new URLSearchParams({
        'form-name': 'proposta',
        'bot-field': form.elements['bot-field'].value,
        nome: form.elements.nome.value.trim(),
        cnpj: form.elements.cnpj.value,
        email: form.elements.email.value.trim(),
        telefone: form.elements.telefone.value,
        lgpd: 'Sim, aceitou a Política de Privacidade'
      });

      var btn = form.querySelector('button[type="submit"]');
      btn.disabled = true;
      status.textContent = 'Enviando seus dados...';
      status.className = 'form__status';

      fetch('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: payload.toString()
      }).then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        status.textContent = 'Recebemos seus dados. Nossa equipe AMAIS FÁCIL entrará em contato em breve.';
        status.className = 'form__status is-ok';
        form.reset();
        Object.keys(RULES).forEach(function (n) {
          if (form.elements[n]) form.elements[n].setAttribute('aria-invalid', 'false');
        });
        $$('[data-err]').forEach(function (s) { s.textContent = ''; });
      }).catch(function () {
        status.textContent = 'Não foi possível enviar agora. Tente de novo em instantes.';
        status.className = 'form__status is-err';
      }).then(function () {
        btn.disabled = false;
      });
    });
  }

  /* =======================================================
     8. Boot
     ======================================================= */
  function boot() {
    measure();
    if (reduced) staticPlace();
    else request();
  }

  boot();
  window.addEventListener('load', function () { measure(); reduced ? staticPlace() : request(); });
  /* o <picture> troca de arquivo ao cruzar o breakpoint — remedir junto */
  if (heroPhoto) {
    heroPhoto.addEventListener('load', function () { measure(); reduced ? staticPlace() : request(); });
  }
  /* fontes trocam métricas e mudam a altura das seções */
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(function () { measure(); reduced ? staticPlace() : request(); });
  }
})();
