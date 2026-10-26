// database/script_maestro.js

db = db.getSiblingDB("utm_desk");

// Limpiar colecciones previas
["incidencias_campus", "contadores", "usuarios"].forEach(c => db.getCollection(c).drop());

const rama = (cat, props, req) => ({
  properties: {
    categoria: { enum: [cat] },
    detalle_especifico: { 
      bsonType: "object", 
      required: req, 
      additionalProperties: false, 
      properties: props 
    }
  }
});

const txt = { bsonType: "string" };
const num = { bsonType: "number", minimum: 0 };

// 1. Crear colección principal con $jsonSchema
db.createCollection("incidencias_campus", {
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: [
        "codigo", "titulo", "descripcion", "categoria", "prioridad",
        "estado", "reportante", "ubicacion", "detalle_especifico", "tags",
        "historial_seguimiento", "evidencias_adjuntas", "horas_invertidas", "fecha_creacion"
      ],
      properties: {
        codigo: { bsonType: "string", pattern: "^INC-\\d{4}-\\d{4}$" },
        titulo: txt,
        descripcion: txt,
        categoria: { enum: ["computo_redes", "infraestructura", "academico"] },
        prioridad: { enum: ["baja", "media", "alta", "critica"] },
        estado: { enum: ["abierta", "en proceso", "en espera", "resuelta", "cerrada"] },
        reportante: { 
          bsonType: "object", 
          required: ["nombre", "correo", "tipo"], 
          properties: { 
            nombre: txt, 
            correo: txt, 
            tipo: { enum: ["estudiante", "docente", "administrativo"] } 
          } 
        },
        ubicacion: { 
          bsonType: "object", 
          required: ["edificio"], 
          properties: { edificio: txt, aula: txt } 
        },
        detalle_especifico: { bsonType: "object" },
        tags: { bsonType: "array", items: txt },
        historial_seguimiento: { 
          bsonType: "array", 
          minItems: 1, 
          items: {
            bsonType: "object", 
            required: ["fecha", "autor", "estado", "comentario"],
            properties: { fecha: { bsonType: "date" }, autor: txt, estado: txt, comentario: txt }
          }
        },
        evidencias_adjuntas: { 
          bsonType: "array", 
          items: { 
            bsonType: "object", 
            required: ["nombre_archivo", "tipo_mime", "peso_kb", "url_storage", "fecha_carga"], 
            properties: { 
              nombre_archivo: txt, 
              tipo_mime: txt, 
              peso_kb: num, 
              url_storage: txt, 
              fecha_carga: { bsonType: "date" } 
            } 
          } 
        },
        horas_invertidas: num,
        fecha_creacion: { bsonType: "date" },
        fecha_resolucion: { bsonType: "date" }
      },
      oneOf: [
        rama("computo_redes", {
          tipo_equipo: txt, ip: txt, vlan: { bsonType: "number", minimum: 1, maximum: 4094 },
          puerto_uplink: txt, equipos_afectados: num
        }, ["tipo_equipo", "ip", "vlan", "puerto_uplink", "equipos_afectados"]),

        rama("infraestructura", {
          tipo_daño: txt, 
          nivel_deterioro: { enum: ["leve", "moderado", "severo"] }, 
          riesgo_seguridad: { enum: ["bajo", "medio", "alto"] }, 
          requiere_contratista: { bsonType: "bool" }
        }, ["tipo_daño", "nivel_deterioro", "riesgo_seguridad", "requiere_contratista"]),

        rama("academico", {
          plataforma: txt, codigo_curso: txt, periodo_escolar: txt, estudiantes_impactados: num
        }, ["plataforma", "codigo_curso", "periodo_escolar", "estudiantes_impactados"])
      ]
    }
  }
});

// 2. Crear colecciones auxiliares
db.createCollection("contadores");
db.createCollection("usuarios");

// 3. Crear Índices obligatorios
db.incidencias_campus.createIndex({ categoria: 1, estado: 1, "ubicacion.edificio": 1 });
db.incidencias_campus.createIndex({ titulo: "text", descripcion: "text" }, { default_language: "spanish", weights: { titulo: 10, descripcion: 5 } });
db.incidencias_campus.createIndex({ fecha_resolucion: 1 }, { expireAfterSeconds: 5184000 }); // TTL 60 días
db.incidencias_campus.createIndex({ codigo: 1 }, { unique: true });

// 4. Cargar contador inicial y usuarios
db.contadores.insertOne({ id: "folio-2026", ultimo: 20 });

const hash = "$2b$10$HOJG5nt0wf887pdPqK4E70EbxnFBXLVjoIy4qdNOCNXu/iQbMM140";
db.usuarios.insertMany([
  { nombre: "Karla Pech", correo: "karla.pech@utmdesk.test", rol: "reportante", password_hash: hash, activo: true },
  { nombre: "Luis Mena", correo: "luis.mena@utmdesk.test", rol: "tecnico", password_hash: hash, activo: true },
  { nombre: "Héctor Poot", correo: "hector.poot@utmdesk.test", rol: "administrador", password_hash: hash, activo: true }
]);

print(" Base de datos utm_desk configurada con éxito.");