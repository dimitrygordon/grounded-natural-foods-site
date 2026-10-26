/* Seed-packet line-art produce icons (48x48, stroke only) + icon picker.
   Presentational. Deals may carry an optional `icon` key; when absent, the
   icon is guessed from the name, and the original emoji is kept if no match. */
(function () {
  "use strict";
  var C = function (x, y, r) { return '<circle cx="' + x + '" cy="' + y + '" r="' + r + '"/>'; };
  var leaf = '<path d="M24 12 C26 7 31 5 35 6 C33 10 29 12 24 12"/>';
  var stem = '<path d="M24 14 L25 7"/>';
  var I = {
    apple: '<path d="M24 14 C18 9 9 12 9 23 C9 33 16 42 24 40 C32 42 39 33 39 23 C39 12 30 9 24 14Z"/>' + stem + leaf,
    pear: '<path d="M24 10 C20 10 19 15 19 19 C13 23 11 30 14 36 C17 42 31 42 34 36 C37 30 35 23 29 19 C29 15 28 10 24 10Z"/><path d="M24 10 L25 5"/><path d="M25 7 C29 4 33 5 34 7 C31 9 28 9 25 7"/>',
    peach: '<path d="M24 14 C14 10 8 18 9 27 C10 37 18 42 24 41 C30 42 38 37 39 27 C40 18 34 10 24 14Z"/><path d="M24 14 C21 22 21 32 24 41"/>' + leaf,
    plum: '<ellipse cx="24" cy="27" rx="13" ry="14"/><path d="M24 13 C22 20 22 34 24 41"/><path d="M24 13 L26 7"/>',
    cherry: C(15, 34, 7) + C(32, 35, 7) + '<path d="M15 27 C17 17 22 10 27 7 M32 28 C31 19 29 12 27 7"/><path d="M27 7 C31 4 37 5 39 8 C35 10 31 10 27 7"/>',
    grapes: C(18, 18, 5) + C(28, 18, 5) + C(23, 26, 5) + C(14, 26, 5) + C(32, 26, 5) + C(18, 34, 5) + C(28, 34, 5) + C(23, 41, 4) + '<path d="M23 13 L24 5 M24 8 C29 5 34 7 36 10 C31 12 27 11 24 8"/>',
    strawberry: '<path d="M10 17 C9 30 18 42 24 43 C30 42 39 30 38 17 C33 13 15 13 10 17Z"/><path d="M14 15 L18 9 L22 14 L24 7 L27 14 L31 9 L34 15"/>' + C(17, 23, .6) + C(24, 22, .6) + C(31, 23, .6) + C(20, 30, .6) + C(28, 30, .6) + C(24, 37, .6),
    blueberry: C(17, 28, 9) + C(31, 22, 8) + '<path d="M14 26 L17 23 L20 26 M28 20 L31 17 L34 20"/>',
    blackberry: '<path d="M24 14 C14 14 12 26 16 34 C19 41 29 41 32 34 C36 26 34 14 24 14Z"/>' + C(20, 21, 3) + C(28, 21, 3) + C(24, 26, 3) + C(19, 29, 3) + C(29, 29, 3) + C(24, 34, 3) + '<path d="M24 14 L24 7 M24 10 C19 6 15 7 13 9 M24 10 C29 6 33 7 35 9"/>',
    raspberry: '<path d="M24 13 C15 13 11 24 15 33 C18 40 30 40 33 33 C37 24 33 13 24 13Z"/>' + C(19, 21, 2.5) + C(24, 20, 2.5) + C(29, 21, 2.5) + C(21, 27, 2.5) + C(27, 27, 2.5) + C(24, 33, 2.5) + '<path d="M18 13 L24 9 L30 13"/>',
    banana: '<path d="M9 14 C10 30 22 40 39 36 C40 33 38 32 36 32 C24 34 15 26 14 13 Z"/><path d="M9 14 L8 10 L12 10 L14 13"/><path d="M13 20 C16 28 24 32 32 32"/>',
    orange: C(24, 26, 15) + '<path d="M24 11 L24 8 M24 9 C28 5 33 6 35 9 C31 11 27 11 24 9"/>' + C(20, 22, .6) + C(28, 28, .6) + C(18, 31, .6),
    lemon: '<path d="M7 25 C9 15 18 11 24 11 C30 11 39 15 41 25 C39 35 30 39 24 39 C18 39 9 35 7 25Z"/><path d="M7 25 L4 25 M41 25 L44 25"/>',
    lime: C(24, 25, 13) + '<path d="M24 12 C24 18 24 32 24 38 M12 21 C18 23 30 23 36 21"/><path d="M37 24 L42 24"/>',
    grapefruit: C(24, 24, 16) + C(24, 24, 12) + '<path d="M24 12 L24 36 M12 24 L36 24 M16 16 L32 32 M32 16 L16 32"/>',
    pineapple: '<ellipse cx="24" cy="32" rx="10" ry="12"/><path d="M16 26 L32 38 M32 26 L16 38 M15 32 L33 32"/><path d="M24 20 L20 6 L24 12 L28 6 L24 20 M24 20 L14 10 M24 20 L34 10"/>',
    mango: '<path d="M14 12 C26 6 40 18 38 30 C36 41 22 44 15 37 C8 30 6 17 14 12Z"/><path d="M15 12 L13 7"/><path d="M14 8 C10 5 6 6 5 9 C9 11 12 10 14 8"/>',
    kiwi: C(24, 24, 15) + C(24, 24, 9) + '<ellipse cx="24" cy="24" rx="3" ry="2"/><path d="M24 15 L24 17 M24 31 L24 33 M15 24 L17 24 M31 24 L33 24 M18 18 L19 19 M30 30 L29 29 M30 18 L29 19 M18 30 L19 29"/>',
    watermelon: '<path d="M6 18 C6 32 15 41 24 41 C33 41 42 32 42 18 Z"/><path d="M10 18 C10 29 17 37 24 37 C31 37 38 29 38 18"/><path d="M18 24 L18 26 M24 26 L24 28 M30 24 L30 26 M21 31 L21 32 M27 31 L27 32"/>',
    cantaloupe: C(24, 25, 15) + '<path d="M12 18 C18 22 30 22 36 18 M10 26 C18 30 30 30 38 26 M13 33 C20 36 28 36 35 33 M20 11 C18 20 18 32 21 40 M28 11 C30 20 30 32 27 40"/>',
    pomegranate: '<path d="M24 14 C13 14 8 22 9 30 C10 38 17 42 24 42 C31 42 38 38 39 30 C40 22 35 14 24 14Z"/><path d="M19 14 L18 8 L21 11 L24 6 L27 11 L30 8 L29 14"/>' + C(20, 27, 2) + C(27, 26, 2) + C(23, 33, 2) + C(30, 32, 2),
    fig: '<path d="M24 8 C20 14 10 22 11 31 C12 38 18 42 24 42 C30 42 36 38 37 31 C38 22 28 14 24 8Z"/><path d="M24 8 L24 5"/><path d="M20 34 C22 36 26 36 28 34"/>',
    avocado: '<path d="M24 6 C18 6 16 14 15 20 C10 26 10 36 17 41 C21 44 27 44 31 41 C38 36 38 26 33 20 C32 14 30 6 24 6Z"/>' + C(24, 31, 6),
    coconut: C(24, 26, 15) + '<path d="M11 20 C18 24 30 24 37 20"/>' + C(19, 16, 1.5) + C(24, 14, 1.5) + C(29, 16, 1.5),
    tomato: '<path d="M24 14 C12 14 8 24 10 31 C12 39 19 42 24 42 C29 42 36 39 38 31 C40 24 36 14 24 14Z"/><path d="M24 15 L24 8 M24 16 L17 12 M24 16 L31 12 M24 16 L19 20 M24 16 L29 20"/><path d="M15 26 C14 30 15 34 18 37"/>',
    cucumber: '<path d="M8 36 C10 22 26 8 38 9 C41 10 41 13 40 16 C36 28 20 40 11 40 C8 40 7 38 8 36Z"/><path d="M16 32 L17 31 M22 27 L23 26 M28 21 L29 20 M33 16 L34 15"/><path d="M38 9 L41 6"/>',
    carrot: '<path d="M30 16 C24 14 12 26 8 40 C22 36 34 24 32 18 Z"/><path d="M17 27 L20 29 M13 33 L16 34 M22 22 L24 24"/><path d="M31 17 C32 11 30 6 28 4 M32 17 C37 14 40 10 41 7 M32 18 C38 18 42 16 44 14"/>',
    radish: '<path d="M24 18 C14 18 12 30 18 36 C20 38 22 40 24 44 C26 40 28 38 30 36 C36 30 34 18 24 18Z"/><path d="M24 18 C20 10 13 7 9 7 C11 13 17 16 24 18 M24 18 C28 10 35 7 39 7 C37 13 31 16 24 18 M24 18 L24 8"/>',
    beet: C(24, 30, 11) + '<path d="M24 41 C24 43 23 45 21 46"/><path d="M22 19 C16 12 15 6 17 3 C21 6 23 12 22 19 M26 19 C32 12 33 6 31 3 C27 6 25 12 26 19"/>',
    potato: '<path d="M10 22 C10 13 22 9 31 12 C40 15 42 25 38 33 C34 41 20 42 14 37 C9 33 10 27 10 22Z"/>' + C(18, 20, .8) + C(29, 18, .8) + C(32, 30, .8) + C(20, 32, .8),
    "sweet-potato": '<path d="M6 30 C6 22 16 14 28 14 C38 14 43 20 41 26 C39 33 28 36 18 36 C11 36 6 34 6 30Z"/><path d="M41 24 L45 22 M6 30 L3 32"/><path d="M16 22 C18 24 18 27 16 29 M28 20 C30 22 30 26 28 28"/>',
    onion: '<path d="M24 10 C16 18 9 23 9 31 C9 39 16 43 24 43 C32 43 39 39 39 31 C39 23 32 18 24 10Z"/><path d="M24 10 L24 4"/><path d="M24 14 C19 22 18 33 22 43 M24 14 C29 22 30 33 26 43"/><path d="M20 43 L19 46 M24 43 L24 46 M28 43 L29 46"/>',
    garlic: '<path d="M24 8 C20 16 10 20 10 30 C10 38 17 42 24 42 C31 42 38 38 38 30 C38 20 28 16 24 8Z"/><path d="M24 8 L24 3"/><path d="M24 16 C20 24 20 34 24 42 M24 16 C28 24 28 34 24 42 M17 22 C14 28 15 36 19 41 M31 22 C34 28 33 36 29 41"/>',
    leek: '<path d="M20 44 L20 22 M28 44 L28 22 M20 44 C20 46 28 46 28 44"/><path d="M20 22 C18 14 12 8 8 4 M24 22 L24 4 M28 22 C30 14 36 8 40 4"/><path d="M20 36 L28 36"/>',
    celery: '<path d="M16 44 L18 20 M24 44 L24 18 M32 44 L30 20 M16 44 C20 46 28 46 32 44"/><path d="M18 20 C14 14 14 9 17 6 C20 9 20 14 18 20 M24 18 C22 12 22 6 25 3 C28 7 27 12 24 18 M30 20 C32 14 34 10 38 9 C37 14 34 18 30 20"/>',
    lettuce: '<path d="M8 28 C6 18 14 10 24 10 C34 10 42 18 40 28 C40 36 32 42 24 42 C16 42 8 36 8 28Z"/><path d="M14 28 C14 20 20 16 24 16 C28 16 34 20 34 28 M19 32 C19 26 22 23 24 23 C26 23 29 26 29 32 M24 42 L24 23"/>',
    kale: '<path d="M24 44 L24 18"/><path d="M24 18 C16 18 10 12 12 4 C14 8 16 6 18 8 C20 6 22 10 24 6 C26 10 28 6 30 8 C32 6 34 8 36 4 C38 12 32 18 24 18Z"/><path d="M24 30 C16 30 10 26 9 20 M24 30 C32 30 38 26 39 20"/>',
    spinach: '<path d="M24 44 L24 30"/><path d="M24 30 C14 28 10 18 14 8 C22 10 26 20 24 30Z"/><path d="M24 30 C34 28 40 20 38 12 C30 12 25 20 24 30Z"/><path d="M24 30 L16 14 M24 30 L33 17"/>',
    cabbage: C(24, 26, 15) + '<path d="M24 11 C18 18 18 34 24 41 M24 11 C30 18 30 34 24 41 M10 22 C16 26 32 26 38 22 M14 34 C20 30 28 30 34 34"/>',
    broccoli: C(17, 18, 7) + C(29, 16, 8) + C(24, 24, 7) + '<path d="M20 28 L18 44 L30 44 L28 28 M24 34 L24 44"/>',
    cauliflower: '<path d="M10 26 C8 16 16 8 24 10 C32 8 40 16 38 26 Z"/>' + C(18, 18, 4) + C(28, 16, 4) + C(24, 22, 3) + '<path d="M10 26 C12 36 18 40 24 40 C30 40 36 36 38 26 M14 28 C16 34 20 36 24 36 M34 28 C32 34 28 36 24 36 M24 40 L24 44"/>',
    "brussels-sprouts": C(16, 30, 9) + C(32, 22, 9) + '<path d="M16 21 C13 27 13 33 16 39 M32 13 C35 19 35 25 32 31 M8 28 C12 30 20 30 24 28 M24 20 C28 22 36 22 40 20"/>',
    "bell-pepper": '<path d="M14 16 C8 18 8 28 10 34 C12 42 20 42 24 38 C28 42 36 42 38 34 C40 28 40 18 34 16 C30 14 26 16 24 18 C22 16 18 14 14 16Z"/><path d="M24 18 C24 14 25 10 28 7"/><path d="M24 22 L24 36"/>',
    chili: '<path d="M30 10 C34 16 32 30 22 38 C16 42 10 43 7 42 C14 38 20 32 24 22 C26 16 27 12 30 10Z"/><path d="M30 10 C31 7 34 5 37 5"/><path d="M28 10 C31 12 33 12 34 10"/>',
    eggplant: '<path d="M30 14 C40 18 40 30 32 38 C24 46 10 44 8 38 C6 32 14 30 18 26 C22 22 22 16 30 14Z"/><path d="M28 12 C30 16 34 17 36 14 C34 11 31 10 28 12 M32 13 L36 6"/>',
    zucchini: '<path d="M8 38 C8 30 26 12 36 10 C42 9 42 14 40 18 C34 28 18 42 12 42 C9 42 8 40 8 38Z"/><path d="M14 34 C22 26 30 18 36 14 M38 10 L42 6"/>',
    squash: '<path d="M22 6 C18 6 18 14 18 20 C10 24 8 32 12 38 C16 44 32 44 36 38 C40 32 38 24 30 20 C30 14 28 6 22 6Z"/><path d="M22 6 L23 3"/><path d="M18 20 C22 22 28 22 30 20"/>',
    pumpkin: '<path d="M24 14 C10 12 4 22 6 30 C8 40 18 42 24 40 C30 42 40 40 42 30 C44 22 38 12 24 14Z"/><path d="M24 14 C18 20 18 34 24 40 M24 14 C30 20 30 34 24 40 M14 16 C10 22 10 32 15 39 M34 16 C38 22 38 32 33 39"/><path d="M24 14 C24 10 25 7 28 5"/>',
    corn: '<path d="M24 6 C17 10 16 24 18 34 L30 34 C32 24 31 10 24 6Z"/><path d="M20 14 L28 14 M19 20 L29 20 M19 26 L29 26 M24 8 L24 34"/><path d="M18 34 C12 30 8 24 8 18 C14 22 16 28 18 34 M30 34 C36 30 40 24 40 18 C34 22 32 28 30 34 M18 34 L24 44 L30 34"/>',
    peas: '<path d="M6 30 C12 18 30 12 42 14 C40 24 26 34 10 34 C7 34 6 32 6 30Z"/>' + C(16, 28, 3.5) + C(24, 25, 3.5) + C(32, 21, 3.5) + '<path d="M42 14 L45 10"/>',
    "green-beans": '<path d="M10 8 C14 20 18 32 28 42 M16 6 C20 18 24 30 34 40 M22 6 C26 16 32 26 42 34"/><path d="M10 8 L8 5 M16 6 L15 3 M22 6 L22 3"/>',
    asparagus: '<path d="M16 44 L18 12 M24 44 L24 8 M32 44 L30 12"/><path d="M18 12 L16 8 L18 4 L20 8 Z M24 8 L22 4 L24 1 L26 4 Z M30 12 L28 8 L30 4 L32 8 Z"/><path d="M14 34 L34 34 M14 38 L34 38"/><path d="M17 22 L19 20 M24 18 L26 16 M31 24 L29 22"/>',
    artichoke: '<path d="M24 6 C18 10 14 18 14 26 C14 34 18 38 24 38 C30 38 34 34 34 26 C34 18 30 10 24 6Z"/><path d="M14 26 C18 24 22 26 24 30 C26 26 30 24 34 26 M16 18 C20 18 22 20 24 23 C26 20 28 18 32 18 M24 38 L24 45"/>',
    mushroom: '<path d="M6 24 C6 14 14 8 24 8 C34 8 42 14 42 24 Z"/><path d="M18 24 C17 32 16 38 18 42 L30 42 C32 38 31 32 30 24"/>' + C(16, 17, 2) + C(27, 14, 2) + C(34, 19, 1.5),
    ginger: '<path d="M8 30 C8 24 14 22 18 24 C20 18 26 16 30 20 C34 16 40 18 40 24 C44 26 42 34 36 34 C34 38 26 38 24 34 C20 38 12 38 12 34 C8 34 8 32 8 30Z"/><path d="M18 28 L20 30 M30 26 L31 28"/>',
    basil: '<path d="M24 44 L24 14"/><path d="M24 32 C16 34 9 30 8 22 C16 20 22 26 24 32Z M24 26 C32 28 39 24 40 16 C32 14 26 20 24 26Z M24 14 C20 10 20 5 24 2 C28 5 28 10 24 14Z"/>',
    herbs: '<path d="M14 44 C16 30 20 20 26 10 M26 10 C30 6 36 5 40 6 M22 22 C16 20 12 16 10 10 C16 12 20 16 22 22 M24 16 C28 12 34 12 38 14 C34 18 28 18 24 16 M18 32 C12 32 8 28 6 24 C12 24 16 28 18 32"/><path d="M10 44 L22 44"/>',
    rosemary: '<path d="M24 44 L24 4"/><path d="M24 10 L18 7 M24 10 L30 7 M24 16 L17 13 M24 16 L31 13 M24 22 L16 19 M24 22 L32 19 M24 28 L17 25 M24 28 L31 25 M24 34 L18 31 M24 34 L30 31"/>',
    mint: '<path d="M24 44 L24 18"/><path d="M24 18 C16 16 12 10 14 4 C20 4 24 10 24 18Z M24 18 C32 16 36 10 34 4 C28 4 24 10 24 18Z M24 30 C16 30 10 26 10 20 C16 20 22 24 24 30Z M24 30 C32 30 38 26 38 20 C32 20 26 24 24 30Z"/>',
    "cider-jug": '<path d="M18 6 L30 6 L30 12 C36 16 38 22 38 28 L38 42 L10 42 L10 28 C10 22 12 16 18 12Z"/><path d="M30 14 C36 12 42 16 40 22 C39 26 37 26 37 26"/><path d="M14 26 L34 26 M14 36 L34 36"/>',
    honey: '<path d="M12 18 L36 18 L36 40 C36 43 34 44 32 44 L16 44 C14 44 12 43 12 40Z"/><path d="M10 12 L38 12 L38 18 L10 18Z"/><path d="M12 24 C16 28 20 22 24 26 C28 30 32 22 36 26"/><path d="M19 32 L24 29 L29 32 L29 38 L24 41 L19 38 Z"/>',
    walnut: '<path d="M24 8 C14 8 9 16 9 25 C9 35 16 42 24 42 C32 42 39 35 39 25 C39 16 34 8 24 8Z"/><path d="M24 8 L24 42 M16 16 C20 20 18 24 14 26 M32 16 C28 20 30 24 34 26 M15 34 C19 32 20 30 24 30 C28 30 29 32 33 34"/>',
    almond: '<path d="M24 4 C14 12 12 24 14 34 C16 42 32 42 34 34 C36 24 34 12 24 4Z"/><path d="M22 14 C20 20 20 28 22 34 M27 18 L28 22 M26 28 L27 31"/>',
    pecan: '<ellipse cx="24" cy="24" rx="10" ry="17"/><path d="M24 7 L24 41 M17 14 L31 14 M15 22 L33 22 M15 30 L33 30 M18 37 L30 37"/>',
    peanut: '<path d="M24 6 C16 6 14 14 17 19 C18 21 18 25 16 28 C12 34 16 42 24 42 C32 42 36 34 32 28 C30 25 30 21 31 19 C34 14 32 6 24 6Z"/><path d="M20 12 L21 13 M27 14 L28 15 M20 32 L21 33 M27 35 L28 36"/>',
    nuts: '<path d="M10 22 C6 30 12 38 18 36 C22 34 24 26 20 20 C17 16 12 18 10 22Z"/><path d="M26 16 C24 24 28 32 34 32 C40 32 42 22 38 16 C34 10 28 10 26 16Z"/><path d="M14 22 L18 32 M32 14 L34 30"/>',
    egg: '<path d="M24 6 C14 6 10 22 10 30 C10 38 16 43 24 43 C32 43 38 38 38 30 C38 22 34 6 24 6Z"/><path d="M17 20 C16 24 16 28 17 31"/>',
    apricot: C(24, 26, 14) + '<path d="M24 12 C21 20 21 32 24 40"/>' + leaf,
    nectarine: '<path d="M24 14 C14 11 9 19 10 28 C11 37 18 41 24 40 C30 41 37 37 38 28 C39 19 34 11 24 14Z"/><path d="M24 14 C22 22 22 32 24 40 M28 24 L30 25 M16 28 L18 29"/>' + leaf,
    cranberry: C(16, 30, 7) + C(30, 32, 7) + C(24, 20, 7) + '<path d="M22 18 L24 16 M14 28 L16 26 M28 30 L30 28"/>',
    papaya: '<path d="M24 4 C16 8 10 18 10 28 C10 38 16 44 24 44 C32 44 38 38 38 28 C38 18 32 8 24 4Z"/><path d="M24 12 C20 18 18 26 18 32 C18 38 30 38 30 32 C30 26 28 18 24 12Z"/>' + C(23, 26, 1) + C(25, 31, 1),
    dragonfruit: '<path d="M24 10 C14 12 8 22 10 32 C12 40 20 44 24 44 C28 44 36 40 38 32 C40 22 34 12 24 10Z"/><path d="M24 10 L22 4 M14 18 L8 14 M34 18 L40 14 M10 30 L4 30 M38 30 L44 30 M16 40 L12 45 M32 40 L36 45"/>',
    persimmon: '<path d="M8 28 C8 18 16 14 24 14 C32 14 40 18 40 28 C40 36 32 42 24 42 C16 42 8 36 8 28Z"/><path d="M16 16 L24 10 L32 16 M24 18 L18 22 L24 14 L30 22 Z M24 10 L24 6"/>',
    turnip: '<path d="M24 16 C12 16 8 26 12 32 C15 37 20 40 24 46 C28 40 33 37 36 32 C40 26 36 16 24 16Z"/><path d="M12 26 C20 28 28 28 36 26"/><path d="M24 16 C20 10 16 6 12 6 M24 16 L24 4 M24 16 C28 10 32 6 36 6"/>',
    parsnip: '<path d="M16 12 C14 12 12 14 14 18 C18 28 22 38 26 46 C28 38 30 28 30 18 C31 14 28 12 26 12 Z"/><path d="M18 20 L21 21 M24 28 L26 28 M20 14 C18 8 14 5 10 4 M24 12 L24 3 M28 13 C30 8 34 5 38 5"/>',
    okra: '<path d="M30 8 C34 14 32 26 24 36 C20 41 14 44 10 44 C12 38 16 30 20 22 C24 14 26 10 30 8Z"/><path d="M30 8 L33 4 M26 14 C22 24 18 34 12 42"/>',
    fennel: '<path d="M10 34 C10 26 18 22 24 22 C30 22 38 26 38 34 C38 40 32 44 24 44 C16 44 10 40 10 34Z"/><path d="M18 22 L16 6 M24 22 L24 4 M30 22 L32 6"/><path d="M16 8 L12 4 M16 8 L20 4 M24 6 L20 2 M24 6 L28 2 M32 8 L28 4 M32 8 L36 4"/>',
    "bok-choy": '<path d="M18 44 C14 36 14 24 18 16 M30 44 C34 36 34 24 30 16 M18 44 L30 44"/><path d="M18 16 C12 12 10 6 14 2 C20 4 22 10 18 16 M30 16 C36 12 38 6 34 2 C28 4 26 10 30 16 M24 44 L24 10 C20 6 20 2 24 0 C28 2 28 6 24 10"/>',
    "salad-mix": '<path d="M6 26 L42 26 C42 36 34 42 24 42 C14 42 6 36 6 26Z"/><path d="M10 26 C10 18 16 14 20 20 C20 12 28 12 28 20 C32 14 38 18 38 26"/><path d="M16 46 L32 46"/>',
    jalapeno: '<path d="M14 10 C24 10 36 22 38 34 C39 40 36 42 32 40 C24 34 14 24 12 14 C12 12 12 10 14 10Z"/><path d="M14 10 C12 7 10 5 8 5"/><path d="M18 18 C22 22 28 28 30 32"/>',
    citrus: C(24, 24, 15) + '<path d="M24 9 L24 39 M9 24 L39 24 M13 13 L35 35 M35 13 L13 35"/>' + C(24, 24, 3),
    grain: '<path d="M24 44 L24 10"/><path d="M24 14 C20 12 18 8 18 4 C22 6 24 10 24 14 M24 14 C28 12 30 8 30 4 C26 6 24 10 24 14 M24 22 C20 20 17 16 17 12 C21 14 24 18 24 22 M24 22 C28 20 31 16 31 12 C27 14 24 18 24 22 M24 30 C20 28 17 24 17 20 C21 22 24 26 24 30 M24 30 C28 28 31 24 31 20 C27 22 24 26 24 30"/>',
    basket: '<path d="M6 22 L42 22 L38 42 L10 42 Z"/><path d="M12 22 C12 10 36 10 36 22"/><path d="M8 30 L40 30 M14 22 L16 42 M24 22 L24 42 M34 22 L32 42"/>',
    sprout: '<path d="M24 44 L24 22"/><path d="M24 26 C16 26 10 20 10 12 C18 12 24 18 24 26Z M24 22 C30 22 38 16 38 8 C30 8 24 14 24 22Z"/><path d="M14 44 L34 44"/>'
  };
  var NAMES = {
    apple: "apple", pear: "pear", peach: "peach", plum: "plum", cherr: "cherry", grape: "grapes", strawberr: "strawberry",
    blueberr: "blueberry", blackberr: "blackberry", raspberr: "raspberry", banana: "banana", clementine: "orange", mandarin: "orange", tangerine: "orange", orange: "orange",
    lemon: "lemon", lime: "lime", grapefruit: "grapefruit", pineapple: "pineapple", mango: "mango", kiwi: "kiwi", watermelon: "watermelon",
    cantaloupe: "cantaloupe", melon: "cantaloupe", pomegranate: "pomegranate", fig: "fig", avocado: "avocado", coconut: "coconut",
    tomato: "tomato", cucumber: "cucumber", carrot: "carrot", radish: "radish", beet: "beet", "sweet potato": "sweet-potato", yam: "sweet-potato",
    potato: "potato", onion: "onion", shallot: "onion", garlic: "garlic", leek: "leek", celery: "celery", lettuce: "lettuce", romaine: "lettuce",
    kale: "kale", spinach: "spinach", cabbage: "cabbage", broccoli: "broccoli", cauliflower: "cauliflower", brussel: "brussels-sprouts",
    "bell pepper": "bell-pepper", pepper: "bell-pepper", jalape: "jalapeno", chili: "chili", chile: "chili", eggplant: "eggplant", zucchini: "zucchini",
    pumpkin: "pumpkin", squash: "squash", corn: "corn", pea: "peas", bean: "green-beans", asparagus: "asparagus", artichoke: "artichoke",
    mushroom: "mushroom", ginger: "ginger", basil: "basil", rosemary: "rosemary", mint: "mint", herb: "herbs", cilantro: "herbs", parsley: "herbs",
    cider: "cider-jug", juice: "cider-jug", honey: "honey", walnut: "walnut", almond: "almond", pecan: "pecan", peanut: "peanut", nut: "nuts",
    egg: "egg", apricot: "apricot", nectarine: "nectarine", cranberr: "cranberry", papaya: "papaya", dragon: "dragonfruit", persimmon: "persimmon",
    turnip: "turnip", parsnip: "parsnip", okra: "okra", fennel: "fennel", "bok choy": "bok-choy", salad: "salad-mix", greens: "salad-mix",
    citrus: "citrus", oat: "grain", grain: "grain", sprout: "sprout", microgreen: "sprout"
  };
  var LABEL = function (k) { return k.replace(/-/g, " ").replace(/\b\w/g, function (c) { return c.toUpperCase(); }); };
  function svg(key, cls) {
    if (!I[key]) return "";
    return '<svg class="' + (cls || "produce-icon") + '" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + I[key] + "</svg>";
  }
  function guess(name) {
    var n = String(name || "").toLowerCase(), best = "", bestPos = 1e9;
    /* product words beat ingredient words ("Apple Pumpkin Cider" is a cider) */
    var PRIORITY = ["cider", "juice", "honey"];
    for (var p = 0; p < PRIORITY.length; p++) if (n.indexOf(PRIORITY[p]) >= 0) return NAMES[PRIORITY[p]];
    /* earliest-matching keyword wins, longest wins ties ("sweet potato" over "potato") */
    Object.keys(NAMES).forEach(function (k) {
      var i = n.indexOf(k);
      if (i >= 0 && (i < bestPos || (i === bestPos && k.length > best.length))) { best = k; bestPos = i; }
    });
    return best ? NAMES[best] : "";
  }
  /* Emoji stripping for display only (stored name is untouched). */
  var EMOJI = /(\p{Extended_Pictographic}|\p{Emoji_Modifier}|\u200d|\ufe0f)+/gu;
  function stripEmoji(s) { return String(s).replace(EMOJI, "").replace(/\s{2,}/g, " ").trim(); }

  /* Searchable picker. Writes the key into the hidden input #inputId. */
  function mountPicker(hostId, inputId, nameInputId) {
    var host = document.getElementById(hostId), input = document.getElementById(inputId);
    if (!host || !input) return;
    host.innerHTML = '<input type="search" class="icon-picker-search" placeholder="Search icons (e.g. apple, kale)…" aria-label="Search icons">' +
      '<div class="icon-picker-grid" role="listbox" aria-label="Produce icons"></div>' +
      '<p class="icon-picker-hint"></p>';
    var search = host.querySelector(".icon-picker-search"), grid = host.querySelector(".icon-picker-grid"), hint = host.querySelector(".icon-picker-hint");
    function current() {
      var nm = nameInputId && document.getElementById(nameInputId);
      return input.value || (nm ? guess(nm.value) : "");
    }
    function draw() {
      var q = search.value.trim().toLowerCase(), cur = current();
      var keys = Object.keys(I).filter(function (k) { return !q || k.indexOf(q) >= 0 || LABEL(k).toLowerCase().indexOf(q) >= 0; });
      grid.innerHTML = '<button type="button" class="icon-pick' + (!input.value ? " is-auto" : "") + '" data-key="" title="Automatic (match the name)"><span class="icon-pick-auto">Auto</span><span class="icon-pick-label">Auto</span></button>' +
        keys.map(function (k) {
          return '<button type="button" role="option" aria-selected="' + (input.value === k) + '" class="icon-pick' + (input.value === k ? " is-on" : "") + (!input.value && cur === k ? " is-guess" : "") + '" data-key="' + k + '" title="' + LABEL(k) + '">' + svg(k) + '<span class="icon-pick-label">' + LABEL(k) + "</span></button>";
        }).join("");
      hint.textContent = input.value ? "Chosen: " + LABEL(input.value) : (cur ? "Auto: " + LABEL(cur) + " (from the name)" : "Auto: no match, the name's emoji will show");
    }
    grid.addEventListener("click", function (e) {
      var b = e.target.closest(".icon-pick"); if (!b) return;
      input.value = b.dataset.key; draw();
    });
    search.addEventListener("input", draw);
    var nm = nameInputId && document.getElementById(nameInputId);
    if (nm) nm.addEventListener("input", draw);
    draw();
  }
  window.ProduceIcons = { icons: I, keys: Object.keys(I), svg: svg, guess: guess, stripEmoji: stripEmoji, label: LABEL, mountPicker: mountPicker };
})();
