import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { MongoClient, ServerApiVersion } from 'mongodb';
import { z } from 'zod';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI || '';
const DB_NAME = process.env.MONGODB_DB_NAME || 'utm_desk';

let db: any;

const client = new MongoClient(MONGODB_URI, {
    serverApi: { version: ServerApiVersion.v1, strict: false, deprecationErrors: true },
});

// ── 1. Esquema de Validación con Zod (400 Bad Request) ────────
const incidenciaSchema = z.object({
    titulo: z.string().min(3, "El título es obligatorio"),
    descripcion: z.string().min(5, "La descripción es obligatoria"),
    categoria: z.enum(["computo_redes", "infraestructura_fisica", "servicios_academicos"]),
    prioridad: z.enum(["baja", "media", "alta", "critica"]),
    ubicacion: z.object({
        edificio: z.string().min(1, "El edificio es obligatorio"),
        aula: z.string().optional(),
    }),
    detalle_especifico: z.record(z.string(), z.any()),
    tags: z.array(z.string()).optional().default([]),
});

const actualizarEstadoSchema = z.object({
    estado: z.enum(["abierta", "en_proceso", "resuelta", "cerrada"]),
    comentario: z.string().min(3, "El comentario de seguimiento es obligatorio"),
    horas_invertidas: z.number().min(0).optional().default(0),
});

async function startServer() {
    try {
        await client.connect();
        db = client.db(DB_NAME);
        console.log(`Conectado exitosamente a MongoDB Atlas: ${DB_NAME}`);

        // ── 2. POST /api/incidencias (Crear con Zod y Folio Atómico) ────────
        app.post('/api/incidencias', async (req: express.Request, res: express.Response) => {
            try {
                const datosValidados = incidenciaSchema.parse(req.body);

                const contadorRes = await db.collection('contadores').findOneAndUpdate(
                    { _id: 'folio-2026' },
                    { $inc: { ultimo: 1 } },
                    { upsert: true, returnDocument: 'after' }
                );

                const numeroFolio = contadorRes?.ultimo ?? contadorRes?.value?.ultimo ?? 1;
                const codigoFolio = `INC-2026-${String(numeroFolio).padStart(4, '0')}`;

                const nuevaIncidencia = {
                    codigo: codigoFolio,
                    ...datosValidados,
                    estado: 'abierta',
                    reportante: {
                        nombre: 'Isaías Couoh',
                        correo: 'isaias.couoh@utmetropolitana.edu.mx',
                        tipo: 'estudiante'
                    },
                    historial_seguimiento: [
                        {
                            fecha: new Date(),
                            autor: 'Isaías Couoh',
                            estado: 'abierta',
                            comentario: 'Incidencia registrada mediante API REST.'
                        }
                    ],
                    evidencias: [],
                    evidencias_adjuntas: [],
                    horas_invertidas: 0,
                    fecha_creacion: new Date()
                };

                await db.collection('incidencias_campus').insertOne(nuevaIncidencia, { bypassDocumentValidation: true });

                return res.status(201).json({
                    message: "Incidencia registrada exitosamente",
                    codigo: codigoFolio,
                    data: nuevaIncidencia
                });

            } catch (error: any) {
                if (error instanceof z.ZodError) {
                    return res.status(400).json({
                        error: "Error de validación con Zod",
                        details: error.issues
                    });
                }
                return res.status(500).json({ error: error.message });
            }
        });

        // ── 3. GET /api/incidencias (Consultar / Listar con filtros opcionales) ────────
        app.get('/api/incidencias', async (req: express.Request, res: express.Response) => {
            try {
                const { categoria, prioridad, estado } = req.query;
                const filtro: any = {};

                if (categoria) filtro.categoria = categoria;
                if (prioridad) filtro.prioridad = prioridad;
                if (estado) filtro.estado = estado;

                const incidencias = await db.collection('incidencias_campus').find(filtro).toArray();

                return res.status(200).json({
                    total: incidencias.length,
                    data: incidencias
                });
            } catch (error: any) {
                return res.status(500).json({ error: error.message });
            }
        });

        // ── 4. PATCH /api/incidencias/:codigo/estado (Actualizar estatus y bitácora) ────────
        app.patch('/api/incidencias/:codigo/estado', async (req: express.Request, res: express.Response) => {
            try {
                const { codigo } = req.params;
                const { estado, comentario, horas_invertidas } = actualizarEstadoSchema.parse(req.body);

                const seguimientoEntry = {
                    fecha: new Date(),
                    autor: 'Técnico Soporte',
                    estado,
                    comentario
                };

                const resultado = await db.collection('incidencias_campus').findOneAndUpdate(
                    { codigo: codigo },
                    {
                        $set: { estado: estado },
                        $inc: { horas_invertidas: horas_invertidas },
                        $push: { historial_seguimiento: seguimientoEntry }
                    },
                    { returnDocument: 'after', bypassDocumentValidation: true }
                );

                const docActualizado = resultado.value || resultado;
                if (!docActualizado) {
                    return res.status(404).json({ error: `Incidencia con código ${codigo} no encontrada` });
                }

                return res.status(200).json({
                    message: "Estado de incidencia actualizado correctamente",
                    data: docActualizado
                });

            } catch (error: any) {
                if (error instanceof z.ZodError) {
                    return res.status(400).json({
                        error: "Error de validación con Zod",
                        details: error.issues
                    });
                }
                return res.status(500).json({ error: error.message });
            }
        });

        app.listen(PORT, () => {
            console.log(`Servidor corriendo en http://localhost:${PORT}`);
        });
    } catch (error) {
        console.error('Error al conectar con la base de datos:', error);
    }
}

startServer();