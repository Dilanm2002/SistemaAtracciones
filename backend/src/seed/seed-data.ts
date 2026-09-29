import { ProductType } from '../modules/atracciones/dto/create-atraccion.dto';

/**
 * Categorías: las de primer nivel ya vienen en database/01_esquema.sql; aquí se
 * completan (ícono, descripción) y se agregan subcategorías con cat_padre_id.
 */
export const CATEGORIAS: { slug: string; nombre: string; icono: string; orden: number; descripcion: string; padre?: string }[] = [
  { slug: 'naturales', nombre: 'Naturaleza', icono: 'trees', orden: 1, descripcion: 'Volcanes, lagunas, páramos y bosques nublados.' },
  { slug: 'aventura', nombre: 'Aventura', icono: 'bike', orden: 2, descripcion: 'Caminatas, deportes y adrenalina.' },
  { slug: 'cultural', nombre: 'Cultura e historia', icono: 'landmark', orden: 3, descripcion: 'Patrimonio colonial, arqueología y tradiciones vivas.' },
  { slug: 'vida-silvestre', nombre: 'Vida silvestre', icono: 'bird', orden: 4, descripcion: 'Fauna única: tortugas gigantes, ballenas y colibríes.', padre: 'naturales' },
  { slug: 'playas', nombre: 'Playa y mar', icono: 'waves', orden: 5, descripcion: 'Snorkel, surf y costa del Pacífico.' },
  { slug: 'tours-ciudad', nombre: 'Tours de ciudad', icono: 'building-2', orden: 6, descripcion: 'Recorridos guiados por las ciudades más bonitas.', padre: 'cultural' },
  { slug: 'trenes-miradores', nombre: 'Trenes y miradores', icono: 'train-front', orden: 7, descripcion: 'Vistas panorámicas y rutas ferroviarias históricas.', padre: 'cultural' },
  { slug: 'gastronomia', nombre: 'Gastronomía', icono: 'utensils', orden: 8, descripcion: 'Cacao, café y sabores ecuatorianos.' },
  { slug: 'montana', nombre: 'Montaña', icono: 'mountain', orden: 9, descripcion: 'Sierra, volcanes y senderismo de altura.' },
];

/** Slug antiguo de los datos de demo → slug del modelo. */
export const SLUG: Record<string, string> = { naturaleza: 'naturales', cultura: 'cultural', playa: 'playas' };

/**
 * Destinos = ciudades del modelo (tabla ciudad). Las que ya trae 01_esquema.sql se
 * reconocen por su código INEC y solo se completan con descripción e imagen.
 */
export const DESTINOS = [
  { codigo: 1, codigoInec: '170150', nombre: 'Quito', provincia: 'Pichincha', imagen: '/img/quito-centro.jpg', descripcion: 'La capital más antigua de Sudamérica y primer Patrimonio Cultural de la Humanidad.' },
  { codigo: 2, codigoInec: '180250', nombre: 'Baños de Agua Santa', provincia: 'Tungurahua', imagen: '/img/casa-arbol.jpg', descripcion: 'La capital de la aventura: cascadas, termas y deportes extremos a los pies del Tungurahua.' },
  { codigo: 3, codigoInec: '200150', nombre: 'Puerto Ayora', provincia: 'Galápagos', imagen: '/img/galapagos-tortugas.jpg', descripcion: 'En la isla Santa Cruz, corazón de las islas encantadas: tortugas gigantes y playas de arena blanca.' },
  { codigo: 4, codigoInec: '020100', nombre: 'Puerto Baquerizo Moreno', provincia: 'Galápagos', imagen: '/img/kicker-rock.jpg', descripcion: 'Capital de Galápagos en San Cristóbal: lobos marinos en el malecón y el icónico León Dormido.' },
  { codigo: 5, codigoInec: '010100', nombre: 'Cuenca', provincia: 'Azuay', imagen: '/img/cuenca.jpg', descripcion: 'Ciudad de cúpulas azules, ríos y el arte del sombrero de paja toquilla.' },
  { codigo: 6, codigoInec: '090150', nombre: 'Guayaquil', provincia: 'Guayas', imagen: '/img/malecon.jpg', descripcion: 'La Perla del Pacífico: malecón, barrio Las Peñas y gastronomía costeña.' },
  { codigo: 7, codigoInec: '100450', nombre: 'Otavalo', provincia: 'Imbabura', imagen: '/img/otavalo.jpg', descripcion: 'Tierra de lagos y del mercado indígena más famoso de los Andes.' },
  { codigo: 8, codigoInec: '170450', nombre: 'Mindo', provincia: 'Pichincha', imagen: '/img/mindo.jpg', descripcion: 'Bosque nublado con más de 500 especies de aves y el mejor cacao.' },
  { codigo: 9, codigoInec: '050100', nombre: 'Latacunga', provincia: 'Cotopaxi', imagen: '/img/cotopaxi.jpg', descripcion: 'Puerta de entrada al volcán Cotopaxi, los páramos y la laguna del Quilotoa.' },
  { codigo: 10, codigoInec: '060100', nombre: 'Riobamba', provincia: 'Chimborazo', imagen: '/img/chimborazo.jpg', descripcion: 'El punto más cercano al Sol y el tren de la Nariz del Diablo en Alausí.' },
  { codigo: 11, codigoInec: '240150', nombre: 'Montañita', provincia: 'Santa Elena', imagen: '/img/montanita.jpg', descripcion: 'Olas perfectas para surfear y ambiente bohemio frente al mar.' },
  { codigo: 12, codigoInec: '130650', nombre: 'Puerto López', provincia: 'Manabí', imagen: '/img/isla-plata.jpg', descripcion: 'Avistamiento de ballenas jorobadas y la Isla de la Plata.' },
  { codigo: 13, codigoInec: '230100', nombre: 'Nueva Loja', provincia: 'Sucumbíos', imagen: '/img/cuyabeno.jpg', descripcion: 'Puerta a la Reserva Cuyabeno: selva amazónica, lagunas negras y delfines rosados.' },
];

export const OPERADORES = [
  { codigo: 101, nombre: 'Andes Explorer Ecuador', ruc: '1792345678001', email: 'reservas@andesexplorer.ec', telefono: '022456789', provincia: 'Pichincha', direccion: 'Av. Amazonas N24-03 y Colón, Quito' },
  { codigo: 102, nombre: 'Galápagos Blue Tours', ruc: '2090123456001', email: 'info@galapagosblue.ec', telefono: '052526789', provincia: 'Galápagos', direccion: 'Av. Charles Darwin, Puerto Ayora' },
  { codigo: 103, nombre: 'Quito Tour Bus', ruc: '1791234567001', email: 'ventas@quitotourbus.ec', telefono: '022567890', provincia: 'Pichincha', direccion: 'Av. Naciones Unidas y Shyris, Quito' },
  { codigo: 104, nombre: 'Amazonía Viva Expediciones', ruc: '2190456789001', email: 'selva@amazoniaviva.ec', telefono: '062830123', provincia: 'Sucumbíos', direccion: 'Av. Quito y 12 de Febrero, Nueva Loja' },
  { codigo: 105, nombre: 'Pacífico Aventura', ruc: '1391234567001', email: 'hola@pacificoaventura.ec', telefono: '052300456', provincia: 'Manabí', direccion: 'Malecón Julio Izurieta, Puerto López' },
  { codigo: 106, nombre: 'Tren Ecuador Experiencias', ruc: '1768123456001', email: 'boletos@trenexperiencias.ec', telefono: '032930126', provincia: 'Chimborazo', direccion: 'Estación de Alausí, Chimborazo' },
  { codigo: 107, nombre: 'Austro Travel Cuenca', ruc: '0190345678001', email: 'tours@austrotravel.ec', telefono: '072845123', provincia: 'Azuay', direccion: 'Calle Larga 7-80, Cuenca' },
];

/** Idiomas que usan los datos de demo y no trae el catálogo base (es, en, fr, de). */
export const IDIOMAS_EXTRA = [
  { codigo: 'pt', nombre: 'Portugues' },
  { codigo: 'qu', nombre: 'Kichwa' },
];

interface SeedAtraccion {
  nombre: string;
  corta: string;
  descripcion: string;
  destino: number;
  operador: number;
  direccion: string;
  punto: string;
  lat: number;
  lng: number;
  precio: number;
  precioNino: number;
  horas: number;
  tipo: ProductType;
  categorias: string[];
  incluye: string[];
  noIncluye: string[];
  recomendaciones: string[];
  insignias?: string[];
  idiomas: string[];
  horarios: string[];
  cupo: number;
  cancelacion?: boolean;
  horasCancelacion?: number;
  destacado?: boolean;
  fotos: string[];
}

const ABRIGO = ['Ropa abrigada e impermeable', 'Protector solar y gafas', 'Zapatos cómodos de caminata'];

export const ATRACCIONES: SeedAtraccion[] = [
  {
    nombre: 'Parque Nacional Cotopaxi y Laguna de Limpiopungo',
    corta: 'Sube hasta los 4.500 m en el volcán activo más famoso del Ecuador y camina entre páramos y caballos salvajes.',
    descripcion:
      'Salimos temprano desde Quito por la Avenida de los Volcanes hasta el Parque Nacional Cotopaxi. Recorremos la laguna de Limpiopungo, donde es común ver venados de cola blanca y curiquingues, y luego subimos en vehículo hasta el parqueadero a 4.500 m.\n\nDesde ahí, quien se anime camina hasta el refugio José Rivas (4.864 m) con vistas al glaciar. El regreso incluye almuerzo típico en una hacienda andina con locro de papa y canelazo.',
    destino: 9, operador: 101,
    direccion: 'Parque Nacional Cotopaxi, control Caspi', punto: 'Parque La Carolina, frente al C.C. Quicentro (Quito)',
    lat: -0.6806, lng: -78.4378, precio: 65, precioNino: 45, horas: 10, tipo: ProductType.GUIDED_TOUR,
    categorias: ['naturaleza', 'aventura'],
    incluye: ['Transporte ida y vuelta desde Quito', 'Guía naturalista bilingüe', 'Entrada al parque', 'Almuerzo típico', 'Bastones de caminata'],
    noIncluye: ['Propinas', 'Bebidas adicionales'], recomendaciones: [...ABRIGO, 'Aclimatarse al menos un día en Quito'],
    insignias: ['best_seller'], idiomas: ['es', 'en'], horarios: ['06:30'], cupo: 16, destacado: true,
    fotos: ['/img/cotopaxi.jpg', '/img/cotopaxi-2.jpg'],
  },
  {
    nombre: 'Laguna del Quilotoa: caminata por el cráter',
    corta: 'Contempla la laguna turquesa dentro de un volcán y desciende hasta su orilla.',
    descripcion:
      'El Quilotoa es una caldera volcánica de 3 km de diámetro con una laguna color esmeralda que cambia de tono con la luz. Visitamos el mirador principal, bajamos por el sendero hasta la orilla (unos 40 minutos) y, si lo deseas, puedes remar en kayak.\n\nEn el camino paramos en Tigua para conocer las pinturas sobre cuero de ovejo de los artistas kichwas y en el mercado de Zumbahua (si es sábado).',
    destino: 9, operador: 101,
    direccion: 'Comunidad Quilotoa, parroquia Zumbahua', punto: 'Parque La Carolina, frente al C.C. Quicentro (Quito)',
    lat: -0.856, lng: -78.9031, precio: 55, precioNino: 38, horas: 9, tipo: ProductType.GUIDED_TOUR,
    categorias: ['naturaleza', 'aventura'],
    incluye: ['Transporte desde Quito', 'Guía bilingüe', 'Entrada comunitaria', 'Almuerzo'],
    noIncluye: ['Kayak ($5)', 'Mula para subir ($10)'], recomendaciones: ABRIGO,
    idiomas: ['es', 'en'], horarios: ['07:00'], cupo: 14,
    fotos: ['/img/quilotoa.jpg', '/img/quilotoa-2.jpg'],
  },
  {
    nombre: 'Ciudad Mitad del Mundo y Museo Intiñan',
    corta: 'Párate con un pie en cada hemisferio y descubre los experimentos del museo solar Intiñan.',
    descripcion:
      'Visita el monumento de 30 metros que marca la latitud 0° 0\' 0" y el museo etnográfico en su interior. Después cruzamos al Museo Intiñan, donde la línea ecuatorial calculada por GPS permite experimentos sorprendentes: equilibrar un huevo sobre un clavo o ver el efecto Coriolis en el agua.\n\nTerminamos con tiempo libre en la plaza para probar helados de paila y comprar artesanías.',
    destino: 1, operador: 103,
    direccion: 'Av. Manuel Córdova Galarza, San Antonio de Pichincha', punto: 'Plaza Grande, Centro Histórico de Quito',
    lat: -0.0022, lng: -78.4558, precio: 25, precioNino: 15, horas: 4, tipo: ProductType.GUIDED_TOUR,
    categorias: ['cultura', 'tours-ciudad'],
    incluye: ['Transporte', 'Entradas al monumento y al Museo Intiñan', 'Guía'], noIncluye: ['Alimentación'],
    recomendaciones: ['Gorra y protector solar: el sol ecuatorial es intenso'],
    insignias: ['best_seller'], idiomas: ['es', 'en', 'fr'], horarios: ['09:00', '14:00'], cupo: 25, destacado: true,
    fotos: ['/img/mitad-mundo.jpg', '/img/mitad-mundo-2.jpg'],
  },
  {
    nombre: 'Centro Histórico de Quito a pie: iglesias y leyendas',
    corta: 'Recorre la Basílica, La Compañía y San Francisco mientras escuchas las leyendas quiteñas.',
    descripcion:
      'Un paseo a pie por el centro histórico mejor conservado de América Latina. Subimos a las torres de la Basílica del Voto Nacional, entramos a la iglesia de La Compañía de Jesús (cubierta con siete toneladas de pan de oro) y cerramos en la Plaza de San Francisco con la leyenda de Cantuña.\n\nIncluye degustación de chocolate ecuatoriano y una parada en la tradicional calle La Ronda.',
    destino: 1, operador: 103,
    direccion: 'Plaza Grande, García Moreno y Chile', punto: 'Frente al Palacio de Carondelet, Plaza Grande',
    lat: -0.2201, lng: -78.5123, precio: 18, precioNino: 10, horas: 3, tipo: ProductType.GUIDED_TOUR,
    categorias: ['cultura', 'tours-ciudad'],
    incluye: ['Guía local certificado', 'Entradas a la Basílica y La Compañía', 'Degustación de chocolate'], noIncluye: ['Transporte al punto de encuentro'],
    recomendaciones: ['Zapatos cómodos: hay calles empinadas'],
    insignias: ['likely_to_sell_out'], idiomas: ['es', 'en'], horarios: ['09:30', '15:00'], cupo: 20,
    fotos: ['/img/quito-centro.jpg', '/img/quito-centro-2.jpg'],
  },
  {
    nombre: 'TelefériQo Quito: ascenso al Rucu Pichincha',
    corta: 'Sube en góndola hasta los 3.945 m y disfruta la mejor vista de Quito y sus volcanes.',
    descripcion:
      'El TelefériQo te lleva en 18 minutos desde el borde occidental de Quito hasta Cruz Loma, a casi 4.000 metros. En días despejados se ven el Cotopaxi, el Cayambe y el Antisana.\n\nDesde la estación superior parte el sendero al Rucu Pichincha para los más aventureros. Ticket con hora de embarque, sin filas.',
    destino: 1, operador: 103,
    direccion: 'Av. Occidental y Av. La Gasca', punto: 'Boletería del TelefériQo',
    lat: -0.192, lng: -78.519, precio: 9, precioNino: 6, horas: 2, tipo: ProductType.SINGLE_TICKET,
    categorias: ['trenes-miradores', 'naturaleza'],
    incluye: ['Ticket de ida y vuelta en góndola', 'Embarque prioritario'], noIncluye: ['Guía', 'Transporte'],
    recomendaciones: ['Ve en la mañana: las nubes suelen cerrarse en la tarde', 'Chompa abrigada'],
    idiomas: ['es'], horarios: ['09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00'], cupo: 60,
    horasCancelacion: 2,
    fotos: ['/img/teleferico.jpg', '/img/teleferico-2.jpg'],
  },
  {
    nombre: 'Ruta de las Cascadas y Pailón del Diablo',
    corta: 'Recorre en chiva la ruta Baños–Río Verde y camina hasta la cascada más impresionante del país.',
    descripcion:
      'Viajamos en chiva por la ruta de las cascadas: Agoyán, Manto de la Novia (con tarabita opcional) y finalmente el Pailón del Diablo, donde un sendero entre helechos te deja literalmente detrás de la caída de agua.\n\nPrepárate para mojarte: la fuerza del agua se siente en todo el cuerpo.',
    destino: 2, operador: 101,
    direccion: 'Río Verde, vía Baños–Puyo km 18', punto: 'Parque central de Baños, junto a la Basílica',
    lat: -1.4007, lng: -78.2744, precio: 30, precioNino: 20, horas: 5, tipo: ProductType.GUIDED_TOUR,
    categorias: ['naturaleza', 'aventura'],
    incluye: ['Transporte en chiva', 'Guía', 'Entrada al Pailón del Diablo'], noIncluye: ['Tarabita ($2)', 'Canopy ($15)'],
    recomendaciones: ['Poncho de agua', 'Muda de ropa seca'],
    insignias: ['best_seller'], idiomas: ['es', 'en'], horarios: ['09:00', '14:00'], cupo: 24, destacado: true,
    fotos: ['/img/pailon-diablo.jpg', '/img/pailon-diablo-2.jpg'],
  },
  {
    nombre: 'Casa del Árbol y Columpio del Fin del Mundo',
    corta: 'Vuela sobre el abismo en el columpio más famoso de Ecuador con el Tungurahua de fondo.',
    descripcion:
      'Subimos a Runtún, a 2.600 m sobre Baños, hasta la Casa del Árbol: una estación de monitoreo sísmico convertida en el columpio más fotografiado del país. Además de balancearte sobre la quebrada, puedes recorrer los miradores y la tirolesa.\n\nSi el cielo está despejado, verás al volcán Tungurahua humeando frente a ti.',
    destino: 2, operador: 101,
    direccion: 'Sector Runtún, Baños', punto: 'Parque central de Baños, junto a la Basílica',
    lat: -1.3697, lng: -78.4172, precio: 15, precioNino: 10, horas: 3, tipo: ProductType.GUIDED_TOUR,
    categorias: ['aventura', 'trenes-miradores'],
    incluye: ['Transporte', 'Entrada a la Casa del Árbol'], noIncluye: ['Tirolesa ($5)'],
    recomendaciones: ['Llega temprano para evitar nubes'],
    idiomas: ['es'], horarios: ['08:00', '11:00', '15:00'], cupo: 30,
    fotos: ['/img/casa-arbol.jpg'],
  },
  {
    nombre: 'Tortugas gigantes en El Chato y túneles de lava',
    corta: 'Camina entre tortugas gigantes en libertad y explora túneles volcánicos en Santa Cruz.',
    descripcion:
      'En la reserva El Chato, en la parte alta de Santa Cruz, las tortugas gigantes pastan libremente entre lagunas y árboles de escalesia. Las observamos a pocos metros, siempre respetando la distancia del parque.\n\nLuego exploramos un túnel de lava de 400 metros formado hace miles de años y visitamos los Gemelos, dos enormes cráteres de colapso.',
    destino: 3, operador: 102,
    direccion: 'Reserva El Chato, parroquia Santa Rosa', punto: 'Muelle de Puerto Ayora',
    lat: -0.695, lng: -90.335, precio: 70, precioNino: 50, horas: 5, tipo: ProductType.GUIDED_TOUR,
    categorias: ['vida-silvestre', 'naturaleza'],
    incluye: ['Transporte', 'Guía naturalista del Parque Nacional Galápagos', 'Entradas', 'Botas de caucho'], noIncluye: ['Tasa de ingreso a Galápagos'],
    recomendaciones: ['Repelente', 'Cámara con zoom'],
    insignias: ['best_seller'], idiomas: ['es', 'en'], horarios: ['08:30', '13:30'], cupo: 16, destacado: true,
    fotos: ['/img/galapagos-tortugas.jpg', '/img/galapagos-tortugas-2.jpg'],
  },
  {
    nombre: 'Las Grietas y Bahía Tortuga: snorkel y playa',
    corta: 'Nada en una grieta volcánica de aguas cristalinas y relájate en una de las playas más lindas del mundo.',
    descripcion:
      'Cruzamos en taxi acuático hasta Punta Estrada y caminamos a Las Grietas, una fisura entre rocas volcánicas con agua mixta dulce-salada ideal para snorkel. Después vamos a Bahía Tortuga, playa de arena blanca donde conviven iguanas marinas, pelícanos y tiburones de punta blanca.',
    destino: 3, operador: 102,
    direccion: 'Punta Estrada y Bahía Tortuga, Puerto Ayora', punto: 'Muelle de Puerto Ayora',
    lat: -0.756, lng: -90.306, precio: 45, precioNino: 35, horas: 4, tipo: ProductType.GUIDED_TOUR,
    categorias: ['playa', 'aventura'],
    incluye: ['Equipo de snorkel', 'Guía', 'Taxi acuático'], noIncluye: ['Alimentación'],
    recomendaciones: ['Bloqueador biodegradable', 'Traje de baño'],
    idiomas: ['es', 'en'], horarios: ['09:00'], cupo: 14,
    fotos: ['/img/las-grietas.jpg'],
  },
  {
    nombre: 'Snorkel en el León Dormido (Kicker Rock)',
    corta: 'Nada junto a tiburones martillo, tortugas marinas y lobos marinos en la roca más icónica de Galápagos.',
    descripcion:
      'Navegamos desde Puerto Baquerizo Moreno hasta el León Dormido, dos rocas volcánicas de 150 m que emergen del océano. En su canal hacemos snorkel con tortugas verdes, rayas águila, lobos marinos y, con suerte, tiburones martillo y de Galápagos.\n\nPor la tarde paramos en una playa de Isla San Cristóbal para descansar y almorzar a bordo.',
    destino: 4, operador: 102,
    direccion: 'Isla San Cristóbal, Galápagos', punto: 'Muelle turístico de Puerto Baquerizo Moreno',
    lat: -0.7806, lng: -89.5156, precio: 165, precioNino: 140, horas: 8, tipo: ProductType.GUIDED_TOUR,
    categorias: ['vida-silvestre', 'playa', 'aventura'],
    incluye: ['Lancha', 'Equipo de snorkel y traje de neopreno', 'Almuerzo a bordo', 'Guía naturalista'], noIncluye: ['Propinas'],
    recomendaciones: ['Pastilla para el mareo', 'Saber nadar es obligatorio'],
    insignias: ['likely_to_sell_out'], idiomas: ['es', 'en'], horarios: ['07:30'], cupo: 16, horasCancelacion: 48, destacado: true,
    fotos: ['/img/kicker-rock.jpg', '/img/kicker-rock-2.jpg'],
  },
  {
    nombre: 'Isla de la Plata: ballenas y piqueros patas azules',
    corta: 'Avista ballenas jorobadas (jun–sep) y camina entre piqueros patas azules en la "Galápagos de los pobres".',
    descripcion:
      'Desde Puerto López navegamos una hora hasta la Isla de la Plata, parte del Parque Nacional Machalilla. Entre junio y septiembre las ballenas jorobadas llegan a aparearse y es casi seguro verlas saltar.\n\nEn la isla caminamos senderos entre colonias de piqueros patas azules, fragatas y albatros, y terminamos con snorkel en el arrecife.',
    destino: 12, operador: 105,
    direccion: 'Parque Nacional Machalilla', punto: 'Malecón de Puerto López, oficina de Pacífico Aventura',
    lat: -1.269, lng: -81.068, precio: 55, precioNino: 40, horas: 8, tipo: ProductType.GUIDED_TOUR,
    categorias: ['vida-silvestre', 'playa'],
    incluye: ['Lancha', 'Guía', 'Snack y agua', 'Equipo de snorkel'], noIncluye: ['Almuerzo'],
    recomendaciones: ['Pastilla para el mareo', 'Gorra'],
    idiomas: ['es', 'en'], horarios: ['08:00'], cupo: 20,
    fotos: ['/img/isla-plata.jpg'],
  },
  {
    nombre: 'Clase de surf en Montañita',
    corta: 'Aprende a pararte en la tabla con instructores locales en el paraíso surfista de Ecuador.',
    descripcion:
      'Clase de 2 horas para principiantes: teoría en la arena, técnica de remada y práctica en olas suaves. Grupos pequeños de máximo 4 alumnos por instructor para que avances rápido.\n\nAl final te quedas con la tabla una hora extra para seguir practicando.',
    destino: 11, operador: 105,
    direccion: 'Playa de Montañita, frente a la punta', punto: 'Escuela de surf Pacífico, calle 15 de Mayo',
    lat: -1.8286, lng: -80.7525, precio: 30, precioNino: 25, horas: 2, tipo: ProductType.GUIDED_TOUR,
    categorias: ['playa', 'aventura'],
    incluye: ['Tabla de surf', 'Licra', 'Instructor certificado', 'Hora extra de tabla'], noIncluye: ['Fotos (opcional $10)'],
    recomendaciones: ['Saber nadar', 'Bloqueador resistente al agua'],
    idiomas: ['es', 'en'], horarios: ['09:00', '11:00', '15:00'], cupo: 8, horasCancelacion: 12,
    fotos: ['/img/montanita.jpg', '/img/montanita-2.jpg'],
  },
  {
    nombre: 'Malecón 2000 y Barrio Las Peñas',
    corta: 'Pasea por el malecón del río Guayas y sube los 444 escalones hasta el faro del cerro Santa Ana.',
    descripcion:
      'Recorremos el Malecón 2000 con sus jardines, el Hemiciclo de la Rotonda y el museo MAAC. Luego subimos por el colorido barrio Las Peñas, el más antiguo de Guayaquil, hasta el faro del cerro Santa Ana, con vista de 360° de la ciudad y el río.\n\nTerminamos con un bolón de verde y café en un local tradicional.',
    destino: 6, operador: 103,
    direccion: 'Malecón Simón Bolívar y 10 de Agosto', punto: 'Torre Morisca del Malecón 2000',
    lat: -2.194, lng: -79.88, precio: 20, precioNino: 12, horas: 3, tipo: ProductType.GUIDED_TOUR,
    categorias: ['tours-ciudad', 'cultura'],
    incluye: ['Guía local', 'Bolón y café'], noIncluye: ['Transporte al punto de encuentro'],
    recomendaciones: ['Ropa fresca e hidratación'],
    idiomas: ['es', 'en'], horarios: ['10:00', '16:00'], cupo: 25,
    fotos: ['/img/malecon.jpg', '/img/malecon-2.jpg'],
  },
  {
    nombre: 'Cuenca colonial y taller de sombreros de paja toquilla',
    corta: 'Descubre la ciudad de las cúpulas azules y aprende cómo se teje el famoso "Panama hat".',
    descripcion:
      'Caminamos por el centro histórico de Cuenca, Patrimonio de la Humanidad: la Catedral de la Inmaculada con sus cúpulas azules, el mercado de flores y el barrio El Vado junto al río Tomebamba.\n\nVisitamos un taller familiar donde verás el proceso completo del sombrero de paja toquilla, Patrimonio Inmaterial de la UNESCO, desde la fibra hasta el acabado.',
    destino: 5, operador: 107,
    direccion: 'Parque Calderón, centro histórico', punto: 'Parque Calderón, frente a la Catedral Nueva',
    lat: -2.8974, lng: -79.0045, precio: 28, precioNino: 18, horas: 4, tipo: ProductType.GUIDED_TOUR,
    categorias: ['cultura', 'tours-ciudad'],
    incluye: ['Guía local', 'Visita al taller', 'Entrada al museo Pumapungo'], noIncluye: ['Compras'],
    recomendaciones: ['Zapatos cómodos'],
    idiomas: ['es', 'en'], horarios: ['09:00', '14:30'], cupo: 20, destacado: true,
    fotos: ['/img/cuenca.jpg'],
  },
  {
    nombre: 'Complejo Arqueológico Ingapirca',
    corta: 'Visita el complejo inca más importante del Ecuador y su Templo del Sol.',
    descripcion:
      'Ingapirca ("muro del inca" en kichwa) fue un centro ceremonial cañari-inca. Su Templo del Sol, de forma elíptica y construido con piedras encajadas sin mortero, sigue alineado con los solsticios.\n\nRecorremos el sitio con un guía de la comunidad y el museo de sitio, y almorzamos en el pueblo de Ingapirca.',
    destino: 5, operador: 107,
    direccion: 'Ingapirca, provincia de Cañar', punto: 'Parque Calderón (Cuenca)',
    lat: -2.5428, lng: -78.8752, precio: 45, precioNino: 30, horas: 7, tipo: ProductType.GUIDED_TOUR,
    categorias: ['cultura'],
    incluye: ['Transporte desde Cuenca', 'Entrada', 'Guía', 'Almuerzo'], noIncluye: ['Bebidas'],
    recomendaciones: ABRIGO,
    idiomas: ['es', 'en'], horarios: ['08:00'], cupo: 20,
    fotos: ['/img/ingapirca.jpg', '/img/ingapirca-2.jpg'],
  },
  {
    nombre: 'Parque Nacional Cajas: lagunas y bosque de polylepis',
    corta: 'Camina entre más de 200 lagunas glaciares y bosques de papel a 4.000 metros.',
    descripcion:
      'El Cajas es un paisaje de páramo salpicado de lagunas de origen glaciar. Hacemos una caminata de dificultad media alrededor de la laguna Toreadora y entramos a un bosque de polylepis (árbol de papel), uno de los bosques más altos del mundo.\n\nAlmuerzo de trucha en Llaviucu antes de regresar a Cuenca.',
    destino: 5, operador: 107,
    direccion: 'Parque Nacional Cajas, refugio Toreadora', punto: 'Parque Calderón (Cuenca)',
    lat: -2.7833, lng: -79.2167, precio: 40, precioNino: 28, horas: 6, tipo: ProductType.GUIDED_TOUR,
    categorias: ['naturaleza', 'aventura'],
    incluye: ['Transporte', 'Guía', 'Almuerzo de trucha'], noIncluye: ['Propinas'],
    recomendaciones: [...ABRIGO, 'Botas impermeables'],
    idiomas: ['es'], horarios: ['07:30'], cupo: 12,
    fotos: ['/img/cajas.jpg', '/img/cajas-2.jpg'],
  },
  {
    nombre: 'Tren Nariz del Diablo (Alausí – Sibambe)',
    corta: 'Viaja en el tren que desafía una montaña en zigzag, una de las rutas ferroviarias más difíciles del mundo.',
    descripcion:
      'Desde la estación de Alausí el tren desciende 500 metros por la Nariz del Diablo mediante un sistema de zigzag único. En Sibambe te recibe el grupo de danza de la comunidad y visitas el museo del Cóndor Puñuna.\n\nTicket en vagón turístico con asientos asignados.',
    destino: 10, operador: 106,
    direccion: 'Estación de tren de Alausí', punto: 'Estación de Alausí (30 min antes)',
    lat: -2.202, lng: -78.847, precio: 33, precioNino: 22, horas: 2.5, tipo: ProductType.SINGLE_TICKET,
    categorias: ['trenes-miradores', 'cultura'],
    incluye: ['Ticket de tren ida y vuelta', 'Refrigerio', 'Show cultural en Sibambe'], noIncluye: ['Transporte hasta Alausí'],
    recomendaciones: ['Lleva tu documento de identidad'],
    insignias: ['best_seller'], idiomas: ['es', 'en'], horarios: ['08:00', '11:00'], cupo: 40, horasCancelacion: 48,
    fotos: ['/img/nariz-diablo.jpg'],
  },
  {
    nombre: 'Chimborazo: refugio Whymper y vicuñas',
    corta: 'Llega al punto más cercano al Sol y camina entre vicuñas en la reserva de producción de fauna.',
    descripcion:
      'Por el abultamiento ecuatorial, la cumbre del Chimborazo es el punto de la Tierra más alejado de su centro. Subimos en vehículo al primer refugio (4.800 m) y caminamos al refugio Whymper (5.000 m) con el glaciar enfrente.\n\nEn la reserva observamos manadas de vicuñas y visitamos una comunidad que produce artesanías de lana.',
    destino: 10, operador: 101,
    direccion: 'Reserva de Producción de Fauna Chimborazo', punto: 'Parque Maldonado, Riobamba',
    lat: -1.4692, lng: -78.8175, precio: 60, precioNino: 42, horas: 9, tipo: ProductType.GUIDED_TOUR,
    categorias: ['naturaleza', 'aventura', 'vida-silvestre'],
    incluye: ['Transporte desde Riobamba', 'Guía de montaña', 'Almuerzo', 'Té de coca'], noIncluye: ['Alquiler de ropa de alta montaña'],
    recomendaciones: [...ABRIGO, 'No apto para personas con problemas cardíacos'],
    idiomas: ['es', 'en'], horarios: ['07:00'], cupo: 14,
    fotos: ['/img/chimborazo.jpg', '/img/chimborazo-2.jpg'],
  },
  {
    nombre: 'Mercado de Otavalo y Cascada de Peguche',
    corta: 'Compra artesanías en el mercado indígena más grande de Sudamérica y visita la cascada sagrada.',
    descripcion:
      'Recorremos la Plaza de los Ponchos, donde los otavaleños venden tejidos, tapices y joyería desde hace siglos. Visitamos un taller de telares tradicionales y la Cascada de Peguche, lugar ceremonial del Inti Raymi.\n\nDe regreso paramos en Cotacachi, capital del cuero, y en el mirador de la laguna de San Pablo.',
    destino: 7, operador: 103,
    direccion: 'Plaza de los Ponchos, Otavalo', punto: 'Parque La Carolina, frente al C.C. Quicentro (Quito)',
    lat: 0.2343, lng: -78.2625, precio: 50, precioNino: 35, horas: 8, tipo: ProductType.GUIDED_TOUR,
    categorias: ['cultura'],
    incluye: ['Transporte desde Quito', 'Guía bilingüe', 'Almuerzo', 'Visita a taller'], noIncluye: ['Compras'],
    recomendaciones: ['Lleva efectivo en billetes pequeños', 'Sábado es el día de mercado más grande'],
    idiomas: ['es', 'en'], horarios: ['08:00'], cupo: 18,
    fotos: ['/img/otavalo.jpg'],
  },
  {
    nombre: 'Mindo: bosque nublado, colibríes y tour del chocolate',
    corta: 'Observa más de 20 especies de colibríes, cruza la tarabita y prueba chocolate del árbol a la barra.',
    descripcion:
      'Mindo es uno de los mejores lugares del mundo para observar aves. Empezamos en un jardín de colibríes, cruzamos el bosque en tarabita hasta las cascadas del Nambillo y visitamos el mariposario.\n\nTerminamos en una fábrica artesanal donde aprendes cómo el cacao fino de aroma ecuatoriano se transforma en chocolate, con degustación incluida.',
    destino: 8, operador: 101,
    direccion: 'Mindo, San Miguel de los Bancos', punto: 'Parque La Carolina, frente al C.C. Quicentro (Quito)',
    lat: -0.052, lng: -78.7757, precio: 58, precioNino: 40, horas: 9, tipo: ProductType.GUIDED_TOUR,
    categorias: ['naturaleza', 'vida-silvestre', 'gastronomia'],
    incluye: ['Transporte desde Quito', 'Guía', 'Tarabita', 'Tour del chocolate', 'Almuerzo'], noIncluye: ['Canopy ($20)'],
    recomendaciones: ['Repelente', 'Poncho de agua'],
    idiomas: ['es', 'en'], horarios: ['07:30'], cupo: 16,
    fotos: ['/img/mindo.jpg'],
  },
  {
    nombre: 'Reserva Cuyabeno: expedición amazónica 4 días',
    corta: 'Tres noches en un lodge en plena selva: delfines rosados, caimanes, anacondas y comunidades siona.',
    descripcion:
      'Una inmersión completa en la Amazonía ecuatoriana. Navegamos en canoa por el río Cuyabeno hasta un lodge ecológico, hacemos caminatas diurnas y nocturnas, nadamos al atardecer en la Laguna Grande y buscamos delfines rosados.\n\nVisitamos la comunidad siona, donde aprenderás a preparar pan de yuca y conocerás la medicina ancestral con el chamán.',
    destino: 13, operador: 104,
    direccion: 'Puente del Cuyabeno, Sucumbíos', punto: 'Terminal de Lago Agrio (traslado incluido)',
    lat: -0.018, lng: -76.318, precio: 420, precioNino: 320, horas: 96, tipo: ProductType.PACKAGE,
    categorias: ['naturaleza', 'vida-silvestre', 'aventura'],
    incluye: ['3 noches de alojamiento en lodge', 'Todas las comidas', 'Canoa motorizada', 'Guía naturalista', 'Botas y ponchos'], noIncluye: ['Vuelo a Lago Agrio', 'Bebidas alcohólicas'],
    recomendaciones: ['Vacuna contra la fiebre amarilla', 'Linterna frontal', 'Ropa de manga larga'],
    insignias: ['likely_to_sell_out'], idiomas: ['es', 'en'], horarios: ['08:00'], cupo: 12, horasCancelacion: 72, destacado: true,
    fotos: ['/img/cuyabeno.jpg', '/img/cuyabeno-2.jpg'],
  },
];

export const USUARIOS: { nombre: string; apellido: string; email: string; password: string; rol: string; telefono: string; documento?: string; operadorCodigo?: number }[] = [
  { nombre: 'Andrea', apellido: 'Salazar', email: 'admin@descubre-ec.com', password: 'Admin123', rol: 'ADMIN', telefono: '0990000001' },
  { nombre: 'Carlos', apellido: 'Operaciones', email: 'operador@descubre-ec.com', password: 'Operador123', rol: 'OPERADOR', telefono: '0990000002', operadorCodigo: 101 },
  { nombre: 'María', apellido: 'Guamán', email: 'cliente@descubre-ec.com', password: 'Cliente123', rol: 'CLIENTE', telefono: '0991234567', documento: '1710034065' },
  { nombre: 'Ana', apellido: 'Torres', email: 'ana.torres@correo.com', password: 'Cliente123', rol: 'CLIENTE', telefono: '0987654321', documento: '0926687856' },
  { nombre: 'Luis', apellido: 'Andrade', email: 'luis.andrade@correo.com', password: 'Cliente123', rol: 'CLIENTE', telefono: '0981122334' },
  { nombre: 'Sofía', apellido: 'Mendoza', email: 'sofia.mendoza@correo.com', password: 'Cliente123', rol: 'CLIENTE', telefono: '0975566778' },
  { nombre: 'John', apellido: 'Smith', email: 'john.smith@mail.com', password: 'Cliente123', rol: 'CLIENTE', telefono: '0998877665' },
  { nombre: 'Daniela', apellido: 'Paredes', email: 'daniela.paredes@correo.com', password: 'Cliente123', rol: 'CLIENTE', telefono: '0969988776' },
];

export const COMENTARIOS: Record<number, string[]> = {
  5: [
    'Una experiencia increíble, el guía conocía cada detalle y la organización fue perfecta.',
    'Superó todas mis expectativas. Los paisajes son de otro mundo, lo recomiendo muchísimo.',
    'Excelente atención desde la reserva hasta el final del tour. Volvería sin pensarlo.',
    'Lo mejor de nuestro viaje por Ecuador. Puntuales, amables y muy seguros.',
  ],
  4: [
    'Muy buen tour, aunque el clima no ayudó del todo. El guía hizo lo posible para que lo disfrutemos.',
    'Bonita experiencia y buen precio. Sugiero llevar más abrigo del que crees necesario.',
    'Todo bien organizado; el almuerzo pudo ser un poco mejor pero valió la pena.',
  ],
  3: ['Estuvo bien, pero el grupo era grande y a veces no se escuchaba al guía.'],
};

export const MENSAJES = [
  { nombre: 'Pedro Salazar', email: 'pedro.salazar@correo.com', asunto: 'RESERVA', mensaje: '¿Puedo cambiar la fecha de mi tour al Cotopaxi sin cancelarlo? Tengo el código DEC-XXXX.' },
  { nombre: 'Emily Johnson', email: 'emily.j@mail.com', asunto: 'OTRO', mensaje: 'Do you have tours in English to Quilotoa on Sundays? We are a group of 6.' },
  { nombre: 'Kawsay Tours', email: 'contacto@kawsaytours.ec', asunto: 'PROVEEDOR', mensaje: 'Somos operadores en Tena y nos gustaría publicar nuestros tours de rafting en su plataforma.' },
  { nombre: 'Gabriela Ruiz', email: 'gabi.ruiz@correo.com', asunto: 'SUGERENCIA', mensaje: 'Sería genial poder filtrar tours aptos para personas mayores o con movilidad reducida.' },
];
