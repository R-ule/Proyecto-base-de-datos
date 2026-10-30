import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { MongoClient, ObjectId, ServerApiVersion, type Document } from 'mongodb';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const app = express();
app.use(cors({
    origin(origin, callback) {
        if (!origin || allowedOrigins.has(origin)) return callback(null, true);
        return callback(new Error('Origen no permitido por CORS.'));
    },
}));
app.use(express.json({ limit: '1mb' }));

const PORT = Number(process.env.PORT ?? 3000);
const MONGODB_URI = process.env.MONGODB_URI || '';
const DB_NAME = process.env.MONGODB_DB_NAME || 'utm_desk';
const JWT_SECRET = process.env.JWT_SECRET ?? '';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN ?? '8h';
const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET ?? 'evidencias';
const esValorDeEjemplo = (value: string): boolean =>
    !value || /placeholder|your[_ -]?|change[_ -]?me|<[^>]+>/i.test(value);
const allowedOrigins = new Set([
    'http://localhost:4200',
    'http://127.0.0.1:4200',
    process.env.FRONTEND_ORIGIN,
].filter((origin): origin is string => Boolean(origin)));

let db: ReturnType<MongoClient['db']>;
let storage: SupabaseClient | undefined;

type UserRole = 'reportante' | 'tecnico' | 'administrador' | 'auditor' | 'superAdmin';

interface AuthenticatedUser {
    id: string;
    correo: string;
    nombre: string;
    rol: UserRole;
}

interface AuthenticatedRequest extends express.Request {
    user?: AuthenticatedUser;
}

interface UserDocument extends Document {
    nombre: string;
    correo: string;
    rol: UserRole;
    activo: boolean;
    password_hash: string;
}

interface ContadorDocument extends Document {
    _id: string;
    ultimo: number;
}

interface SeguimientoEntry {
    fecha: Date;
    autor: string;
    estado: string;
    comentario: string;
}

interface IncidenciaDocument extends Document {
    codigo: string;
    estado: string;
    horas_invertidas: number;
    historial_seguimiento: SeguimientoEntry[];
    evidencias: EvidenciaDocument[];
    responsable_atencion?: { nombre: string; correo: string };
    tecnico_asignado?: { nombre: string; correo: string };
    asignado_a?: { nombre: string; correo: string };
    reportante?: { nombre: string; correo: string };
    fecha_creacion?: Date;
}

interface EvidenciaDocument {
    tipo: string;
    nombre_original: string;
    storage_path: string;
    tamano_bytes: number;
    fecha_carga: Date;
}

const routeParam = (value: string | string[] | undefined): string =>
    typeof value === 'string' ? value : Array.isArray(value) ? value[0] ?? '' : '';

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
    reportante: z.object({
        nombre: z.string().min(1),
        correo: z.string().email(),
        tipo: z.enum(['estudiante', 'docente', 'administrativo']),
    }).optional(),
});

const EMAIL_REGEX = /^[A-Za-z0-9]+(?:\.[A-Za-z0-9]+)*@[A-Za-z0-9]+(?:\.[A-Za-z0-9]+)+$/;

const actualizarEstadoSchema = z.object({
    estado: z.enum(["abierta", "en_proceso", "en_espera", "resuelta", "cerrada"]),
    comentario: z.string().min(3, "El comentario de seguimiento es obligatorio"),
    horas_invertidas: z.number().min(0).optional().default(0),
    autor: z.object({
        nombre: z.string().min(1),
        correo: z.string().email(),
    }).optional(),
});

const loginSchema = z.object({
    correo: z.string().trim().regex(EMAIL_REGEX),
    password: z.string().min(6).max(128),
});

const registroSchema = z.object({
    nombre: z.string().trim().min(2).max(100),
    correo: z.string().trim().regex(EMAIL_REGEX).transform((correo) => correo.toLowerCase()),
    password: z.string().min(6).max(8),
}).strict();

const usuarioNuevoSchema = z.object({
    nombre: z.string().min(2).max(100),
    correo: z.string().trim().regex(EMAIL_REGEX),
    rol: z.enum(['reportante', 'tecnico', 'administrador', 'auditor']),
    password: z.string().min(6).max(8),
});

const rolSchema = z.object({
    rol: z.enum(['reportante', 'tecnico', 'administrador', 'auditor']),
});

const moderacionSchema = z.object({
    motivo: z.enum(['contenido_inapropiado', 'informacion_personal', 'duplicado', 'otro']),
    comentario: z.string().max(500).optional().default(''),
});

const decisionModeracionSchema = z.object({
    decision: z.enum(['cerrado', 'ocultar']),
    nota: z.string().max(500).optional().default(''),
});

const asignacionUsuarioSchema = z.object({
    usuarioId: z.string().min(1),
});

const rolNormalizado = (rol: string): UserRole =>
    rol === 'superAdmin' || rol === 'administrador' || rol === 'tecnico' || rol === 'auditor' || rol === 'reportante'
        ? rol
        : 'reportante';

const esAdministrador = (rol: UserRole): boolean =>
    rol === 'administrador' || rol === 'superAdmin';

const esModerador = (rol: UserRole): boolean =>
    esAdministrador(rol) || rol === 'auditor';

const obtenerMetricasModeracion = async () => {
    const [promedioPorEdificio, etiquetasFrecuentes, reportesActivos, pendientesRevision] = await Promise.all([
        db.collection('incidencias_campus').aggregate([
            { $match: { fecha_cierre: { $type: 'date' } } },
            { $group: {
                _id: '$ubicacion.edificio',
                promedio_horas: { $avg: { $divide: [{ $subtract: ['$fecha_cierre', '$fecha_creacion'] }, 3600000] } },
            } },
            { $sort: { promedio_horas: -1 } },
            { $limit: 8 },
        ]).toArray(),
        db.collection('incidencias_campus').aggregate([
            { $unwind: '$tags' },
            { $group: { _id: '$tags', total: { $sum: 1 } } },
            { $sort: { total: -1 } },
            { $limit: 5 },
        ]).toArray(),
        db.collection('incidencias_campus').countDocuments({
            estado: { $in: ['abierta', 'en_proceso', 'en_espera'] },
        }),
        db.collection('moderacion_reportes').countDocuments({ estado: 'pendiente' }),
    ]);
    return { promedioPorEdificio, etiquetasFrecuentes, reportesActivos, pendientesRevision };
};

const autenticar: express.RequestHandler = async (req, res, next) => {
    const auth = req.headers.authorization;
    if (!auth?.startsWith('Bearer ')) {
        res.status(401).json({ error: 'Se requiere iniciar sesión.' });
        return;
    }

    let claims: string | jwt.JwtPayload;
    try {
        claims = jwt.verify(auth.slice(7), JWT_SECRET);
    } catch {
        res.status(401).json({ error: 'La sesión venció o no es válida.' });
        return;
    }
    if (typeof claims === 'string' || typeof claims.sub !== 'string' || !ObjectId.isValid(claims.sub)) {
        res.status(401).json({ error: 'La sesión no es válida.' });
        return;
    }
    const user = await db.collection<UserDocument>('usuarios').findOne({
        _id: new ObjectId(claims.sub),
        activo: true,
    });
    if (!user) {
        res.status(401).json({ error: 'La cuenta está inactiva o ya no existe.' });
        return;
    }
    (req as AuthenticatedRequest).user = {
        id: user._id.toString(),
        correo: user.correo,
        nombre: user.nombre,
        rol: rolNormalizado(user.rol),
    };
    next();
};

const requerirAdministrador: express.RequestHandler = (req, res, next) => {
    const user = (req as AuthenticatedRequest).user;
    if (!user || !esAdministrador(user.rol)) {
        res.status(403).json({ error: 'Se requiere perfil administrador.' });
        return;
    }
    next();
};

const requerirModerador: express.RequestHandler = (req, res, next) => {
    const user = (req as AuthenticatedRequest).user;
    if (!user || !esModerador(user.rol)) {
        res.status(403).json({ error: 'Se requiere perfil auditor o administrador.' });
        return;
    }
    next();
};

const esTecnico: express.RequestHandler = (req, res, next) => {
    const user = (req as AuthenticatedRequest).user;
    if (!user || !['tecnico', 'administrador', 'superAdmin'].includes(user.rol)) {
        res.status(403).json({ error: 'Se requiere perfil técnico o administrador.' });
        return;
    }
    next();
};

const usuarioPublico = (user: UserDocument) => ({
    id: user._id.toString(),
    nombre: user.nombre,
    correo: user.correo,
    rol: rolNormalizado(user.rol),
    activo: user.activo,
});

async function startServer() {
    if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
        console.error('PORT debe ser un número entero entre 1 y 65535.');
        process.exitCode = 1;
        return;
    }

    if (!MONGODB_URI) {
        console.error('MONGODB_URI no está definida en el archivo .env de la raíz del proyecto.');
        process.exitCode = 1;
        return;
    }
    if (JWT_SECRET.length < 32) {
        console.error('JWT_SECRET debe tener al menos 32 caracteres en el .env de la raíz.');
        process.exitCode = 1;
        return;
    }

    let client: MongoClient | undefined;
    try {
        client = new MongoClient(MONGODB_URI, {
            serverApi: { version: ServerApiVersion.v1, strict: false, deprecationErrors: true },
        });
        await client.connect();
        db = client.db(DB_NAME);
        console.log(`Conectado exitosamente a MongoDB Atlas: ${DB_NAME}`);
        await db.collection<UserDocument>('usuarios').createIndex(
            { correo: 1 },
            { unique: true, name: 'idx_unico_correo' },
        );
        await db.collection('seguimientos_reportes').createIndex(
            { codigo: 1, correo: 1 },
            { unique: true, name: 'idx_seguimiento_codigo_correo' },
        );
        await db.collection('moderacion_reportes').createIndex(
            { estado: 1, fecha_creacion: -1 },
            { name: 'idx_moderacion_estado_fecha' },
        );
        await db.collection('comentarios_incidencias').createIndex(
            { codigo: 1, fecha: -1 },
            { name: 'idx_comentarios_codigo_fecha' },
        );

        if (!esValorDeEjemplo(SUPABASE_URL) && !esValorDeEjemplo(SUPABASE_SERVICE_ROLE_KEY)) {
            storage = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
                auth: { persistSession: false, autoRefreshToken: false },
            });
        }

        app.get('/health', (_req: express.Request, res: express.Response) =>
            res.status(200).json({
                status: 'ok',
                database: 'connected',
                storage: storage ? 'configured' : 'not_configured',
            })
        );

        app.post('/api/auth/login', async (req: express.Request, res: express.Response) => {
            try {
                const { correo, password } = loginSchema.parse(req.body);
                const user = await db.collection<UserDocument>('usuarios').findOne({
                    correo: correo.toLowerCase(),
                    activo: true,
                });
                if (!user || !(await bcrypt.compare(password, user.password_hash))) {
                    return res.status(401).json({ error: 'Correo o contraseña incorrectos.' });
                }

                const token = jwt.sign(
                    { correo: user.correo, nombre: user.nombre, rol: user.rol },
                    JWT_SECRET,
                    { subject: user._id.toString(), expiresIn: JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'] },
                );
                return res.status(200).json({ token, usuario: usuarioPublico(user) });
            } catch (error) {
                if (error instanceof z.ZodError) {
                    return res.status(400).json({ error: 'Datos de inicio de sesión inválidos.' });
                }
                console.error('Error al iniciar sesión:', error);
                return res.status(500).json({ error: 'No se pudo iniciar sesión.' });
            }
        });

        app.post('/api/auth/register', async (req: express.Request, res: express.Response) => {
            const parsed = registroSchema.safeParse(req.body);
            if (!parsed.success) {
                return res.status(400).json({
                    error: 'Ingresa un nombre, correo válido (solo letras, números, puntos y @) y contraseña de entre 6 y 8 caracteres.',
                });
            }

            try {
                const user = {
                    nombre: parsed.data.nombre,
                    correo: parsed.data.correo,
                    rol: 'reportante' as const,
                    activo: true,
                    password_hash: await bcrypt.hash(parsed.data.password, 12),
                };
                const result = await db.collection<UserDocument>('usuarios').insertOne(user);
                const createdUser: UserDocument = { ...user, _id: result.insertedId };
                const token = jwt.sign(
                    { correo: createdUser.correo, nombre: createdUser.nombre, rol: createdUser.rol },
                    JWT_SECRET,
                    { subject: createdUser._id.toString(), expiresIn: JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'] },
                );
                return res.status(201).json({ token, usuario: usuarioPublico(createdUser) });
            } catch (error) {
                if (typeof error === 'object' && error !== null && 'code' in error && error.code === 11000) {
                    return res.status(409).json({ error: 'Ya existe una cuenta con ese correo.' });
                }
                console.error('Error al registrar usuario:', error);
                return res.status(500).json({ error: 'No se pudo crear la cuenta.' });
            }
        });

        app.use('/api', autenticar);

        app.get('/api/auth/me', async (req: AuthenticatedRequest, res: express.Response) => {
            const user = await db.collection<UserDocument>('usuarios').findOne({ _id: new ObjectId(req.user!.id) });
            if (!user) return res.status(401).json({ error: 'La cuenta está inactiva o ya no existe.' });
            return res.json({ usuario: usuarioPublico(user) });
        });

        app.get('/api/seguimientos', async (req: AuthenticatedRequest, res: express.Response) => {
            const seguidos = await db.collection('seguimientos_reportes')
                .find({ correo: req.user!.correo }, { projection: { _id: 0, codigo: 1 } })
                .toArray();
            return res.json({ data: seguidos.map((entry) => entry.codigo) });
        });

        app.get('/api/mis-reportes', async (req: AuthenticatedRequest, res: express.Response) => {
            const data = await db.collection<IncidenciaDocument>('incidencias_campus')
                .find({ 'reportante.correo': req.user!.correo })
                .sort({ fecha_creacion: -1 })
                .toArray();
            return res.json({ total: data.length, data });
        });

        app.post('/api/seguimientos/:codigo', async (req: AuthenticatedRequest, res: express.Response) => {
            const codigo = routeParam(req.params.codigo);
            const exists = await db.collection('incidencias_campus').findOne(
                { codigo },
                { projection: { _id: 1 } },
            );
            if (!exists) return res.status(404).json({ error: `No existe el reporte ${codigo}.` });

            await db.collection('seguimientos_reportes').updateOne(
                { codigo, correo: req.user!.correo },
                { $setOnInsert: { codigo, correo: req.user!.correo, fecha: new Date() } },
                { upsert: true },
            );
            return res.status(201).json({ siguiendo: true });
        });

        app.delete('/api/seguimientos/:codigo', async (req: AuthenticatedRequest, res: express.Response) => {
            const codigo = routeParam(req.params.codigo);
            await db.collection('seguimientos_reportes').deleteOne({
                codigo,
                correo: req.user!.correo,
            });
            return res.status(200).json({ siguiendo: false });
        });

        app.get('/api/incidencias/:codigo/seguidores', async (req: AuthenticatedRequest, res) => {
            const codigo = routeParam(req.params.codigo);
            const exists = await db.collection('incidencias_campus').findOne({ codigo }, { projection: { _id: 1 } });
            if (!exists) return res.status(404).json({ error: 'No se encontró el reporte.' });
            const [total, actual] = await Promise.all([
                db.collection('seguimientos_reportes').countDocuments({ codigo }),
                db.collection('seguimientos_reportes').countDocuments({ codigo, correo: req.user!.correo }),
            ]);
            return res.json({ total: Math.max(0, total - actual), siguiendo: actual > 0 });
        });

        app.post('/api/incidencias/:codigo/comentarios', async (req: AuthenticatedRequest, res: express.Response) => {
            const codigo = routeParam(req.params.codigo);
            const body = z.object({ comentario: z.string().trim().min(3).max(500) }).safeParse(req.body);
            if (!body.success) return res.status(400).json({ error: 'El comentario debe tener entre 3 y 500 caracteres.' });

            const exists = await db.collection('incidencias_campus').findOne({ codigo }, { projection: { _id: 1 } });
            if (!exists) return res.status(404).json({ error: 'No se encontró el reporte.' });
            await db.collection('comentarios_incidencias').insertOne({
                codigo,
                autor: { nombre: req.user!.nombre, correo: req.user!.correo },
                comentario: body.data.comentario,
                fecha: new Date(),
            });
            return res.status(201).json({ message: 'Comentario guardado.' });
        });

        app.get('/api/incidencias/:codigo/comentarios', async (req, res) => {
            const codigo = routeParam(req.params.codigo);
            const data = await db.collection('comentarios_incidencias')
                .find({ codigo }, { projection: { _id: 0 } })
                .sort({ fecha: -1 })
                .toArray();
            return res.json({ data });
        });

        app.post('/api/incidencias/:codigo/moderacion', async (req: AuthenticatedRequest, res: express.Response) => {
            const codigo = routeParam(req.params.codigo);
            const body = moderacionSchema.safeParse(req.body);
            if (!body.success) return res.status(400).json({ error: 'El motivo de reporte no es válido.' });

            const exists = await db.collection('incidencias_campus').findOne(
                { codigo },
                { projection: { _id: 1 } },
            );
            if (!exists) return res.status(404).json({ error: 'No se encontró el reporte.' });

            const registro = {
                codigo,
                motivo: body.data.motivo,
                comentario: body.data.comentario,
                reportado_por: { nombre: req.user!.nombre, correo: req.user!.correo },
                estado: 'pendiente',
                fecha_creacion: new Date(),
            };
            const result = await db.collection('moderacion_reportes').insertOne(registro);
            return res.status(201).json({ id: result.insertedId.toString(), estado: registro.estado });
        });

        app.get('/api/admin/summary', requerirAdministrador, async (_req, res) => {
            const inicioMes = new Date();
            inicioMes.setDate(1);
            inicioMes.setHours(0, 0, 0, 0);
            const metricasModeracion = obtenerMetricasModeracion();
            const [estados, categorias, usuarios, abiertos, cerrados, prioridadAlta, resueltosMes, total, usuariosActivos] = await Promise.all([
                db.collection('incidencias_campus').aggregate([
                    { $group: { _id: '$estado', total: { $sum: 1 } } },
                ]).toArray(),
                db.collection('incidencias_campus').aggregate([
                    { $group: { _id: '$categoria', total: { $sum: 1 } } },
                    { $sort: { total: -1 } },
                ]).toArray(),
                db.collection<UserDocument>('usuarios').aggregate([
                    { $match: { activo: true } },
                    { $group: { _id: '$rol', total: { $sum: 1 } } },
                ]).toArray(),
                db.collection('incidencias_campus').countDocuments({ estado: { $in: ['abierta', 'en_proceso', 'en_espera'] } }),
                db.collection('incidencias_campus').countDocuments({ estado: { $in: ['resuelta', 'cerrada'] } }),
                db.collection('incidencias_campus').countDocuments({
                    estado: { $in: ['abierta', 'en_proceso', 'en_espera'] },
                    prioridad: { $in: ['alta', 'critica'] },
                }),
                db.collection('incidencias_campus').countDocuments({
                    estado: { $in: ['resuelta', 'cerrada'] },
                    fecha_cierre: { $gte: inicioMes },
                }),
                db.collection('incidencias_campus').countDocuments(),
                db.collection('usuarios').countDocuments({ activo: true }),
            ]);
            const { promedioPorEdificio, etiquetasFrecuentes } = await metricasModeracion;
            const totalUsuarios = await db.collection('usuarios').countDocuments();
            const pendientesRevision = await db.collection('moderacion_reportes').countDocuments({ estado: 'pendiente' });
            return res.json({
                total,
                abiertos,
                cerrados,
                prioridadAlta,
                resueltosMes,
                pendientesRevision,
                porEstado: estados,
                porCategoria: categorias,
                promedioPorEdificio,
                etiquetasFrecuentes,
                usuarios: { total: totalUsuarios, activos: usuariosActivos, porRol: usuarios },
            });
        });

        app.get('/api/moderacion/summary', requerirModerador, async (_req, res) => {
            return res.json(await obtenerMetricasModeracion());
        });

        app.get('/api/admin/users', requerirAdministrador, async (_req, res) => {
            const users = await db.collection<UserDocument>('usuarios')
                .find({}, { projection: { password_hash: 0 } })
                .sort({ nombre: 1 })
                .toArray();
            return res.json({ total: users.length, data: users.map(usuarioPublico) });
        });

        app.post('/api/admin/users', requerirAdministrador, async (req, res) => {
            const parsed = usuarioNuevoSchema.safeParse(req.body);
            if (!parsed.success) return res.status(400).json({ error: 'Revisa nombre, correo, rol y contraseña (de 6 a 8 caracteres).' });
            const correo = parsed.data.correo.toLowerCase();
            const duplicate = await db.collection<UserDocument>('usuarios').findOne({ correo }, { projection: { _id: 1 } });
            if (duplicate) return res.status(409).json({ error: 'Ya existe una cuenta con ese correo.' });
            const user = {
                nombre: parsed.data.nombre,
                correo,
                rol: parsed.data.rol,
                activo: true,
                password_hash: await bcrypt.hash(parsed.data.password, 12),
            };
            const result = await db.collection<UserDocument>('usuarios').insertOne(user);
            return res.status(201).json({
                data: usuarioPublico({ ...user, _id: result.insertedId } as UserDocument),
            });
        });

        app.patch('/api/admin/users/:id/role', requerirAdministrador, async (req: AuthenticatedRequest, res) => {
            const parsed = rolSchema.safeParse(req.body);
            if (!parsed.success) return res.status(400).json({ error: 'El perfil solicitado no es válido.' });
            const id = routeParam(req.params.id);
            if (!ObjectId.isValid(id)) return res.status(400).json({ error: 'El usuario no es válido.' });
            if (id === req.user!.id && parsed.data.rol !== 'administrador') {
                return res.status(400).json({ error: 'No puedes quitarte el perfil de administrador.' });
            }
            const result = await db.collection<UserDocument>('usuarios').updateOne(
                { _id: new ObjectId(id), rol: { $ne: 'superAdmin' } },
                { $set: { rol: parsed.data.rol } },
            );
            if (!result.matchedCount) return res.status(404).json({ error: 'No se encontró el usuario o es superadministrador protegido.' });
            return res.json({ message: 'Perfil actualizado.' });
        });

        const obtenerColaModeracion: express.RequestHandler = async (req, res) => {
            const data = await db.collection('moderacion_reportes')
                .find(req.query.incluirCerrados === 'true' ? {} : { estado: 'pendiente' })
                .sort({ fecha_creacion: -1 })
                .toArray();
            return res.json({ total: data.length, data });
        };
        app.get('/api/moderacion', requerirModerador, obtenerColaModeracion);
        app.get('/api/admin/moderation', requerirAdministrador, obtenerColaModeracion);

        const resolverModeracion: express.RequestHandler = async (req, res) => {
            const authenticatedRequest = req as AuthenticatedRequest;
            const id = routeParam(req.params.id);
            if (!ObjectId.isValid(id)) return res.status(400).json({ error: 'El folio de moderación no es válido.' });
            const parsed = decisionModeracionSchema.safeParse(req.body);
            if (!parsed.success) return res.status(400).json({ error: 'La decisión no es válida.' });
            const registro = await db.collection('moderacion_reportes').findOneAndUpdate(
                { _id: new ObjectId(id), estado: 'pendiente' },
                { $set: {
                    estado: parsed.data.decision,
                    nota_revision: parsed.data.nota,
                    revisado_por: { nombre: authenticatedRequest.user!.nombre, correo: authenticatedRequest.user!.correo },
                    fecha_revision: new Date(),
                } },
                { returnDocument: 'after' },
            );
            if (!registro) return res.status(404).json({ error: 'El reporte de moderación ya fue atendido o no existe.' });
            return res.json({ data: registro });
        };
        app.patch('/api/moderacion/:id', requerirModerador, resolverModeracion);
        app.patch('/api/admin/moderation/:id', requerirAdministrador, resolverModeracion);

        app.post(
            '/api/incidencias/:codigo/evidencias',
            express.raw({ type: ['image/jpeg', 'image/png', 'application/pdf'], limit: '10mb' }),
            async (req: AuthenticatedRequest, res) => {
                if (!storage) return res.status(503).json({ error: 'El almacenamiento de evidencias no está configurado.' });
                if (!Buffer.isBuffer(req.body) || req.body.length === 0) return res.status(400).json({ error: 'El archivo está vacío.' });
                const tipo = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
                if (!['image/jpeg', 'image/png', 'application/pdf'].includes(tipo)) {
                    return res.status(415).json({ error: 'Solo se permiten JPG, PNG y PDF.' });
                }
                const coincideTipo = tipo === 'image/jpeg'
                    ? req.body.length >= 3 && req.body.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))
                    : tipo === 'image/png'
                        ? req.body.length >= 8 && req.body.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
                        : req.body.subarray(0, 4).toString('ascii') === '%PDF';
                if (!coincideTipo) return res.status(415).json({ error: 'El contenido del archivo no coincide con su formato declarado.' });
                const col = db.collection<IncidenciaDocument>('incidencias_campus');
                const codigo = routeParam(req.params.codigo);
                const incidencia = await col.findOne({ codigo });
                if (!incidencia) return res.status(404).json({ error: 'No se encontró el reporte.' });
                if (incidencia.reportante?.correo !== req.user!.correo && !esAdministrador(req.user!.rol) && !['tecnico'].includes(req.user!.rol)) {
                    return res.status(403).json({ error: 'No tienes permiso para adjuntar archivos a este reporte.' });
                }
                const original = String(req.query.nombre ?? 'evidencia').replace(/[^\w.-]/g, '_').slice(0, 100);
                if ((incidencia.evidencias?.length ?? 0) >= 5) return res.status(400).json({ error: 'El reporte ya tiene el máximo de cinco evidencias.' });
                const ruta = `${codigo}/${Date.now()}-${original}`;
                const uploaded = await storage.storage.from(SUPABASE_BUCKET).upload(ruta, req.body, {
                    contentType: tipo,
                    upsert: false,
                });
                if (uploaded.error) {
                    console.error('Error al subir evidencia:', uploaded.error.message);
                    return res.status(502).json({ error: 'No se pudo guardar el archivo en almacenamiento.' });
                }
                const metadata = {
                    tipo,
                    nombre_original: original,
                    storage_path: ruta,
                    tamano_bytes: req.body.length,
                    fecha_carga: new Date(),
                };
                try {
                    await col.updateOne(
                        { codigo },
                        [{
                            $set: {
                                evidencias: {
                                    $concatArrays: [
                                        { $ifNull: ['$evidencias', []] },
                                        { $literal: [metadata] },
                                    ],
                                },
                            },
                        }],
                    );
                } catch (error) {
                    await storage.storage.from(SUPABASE_BUCKET).remove([ruta]);
                    throw error;
                }
                return res.status(201).json({ data: metadata });
            },
        );

        app.get('/api/incidencias/:codigo/evidencias', async (req, res) => {
            const codigo = routeParam(req.params.codigo);
            const incidencia = await db.collection<IncidenciaDocument>('incidencias_campus').findOne(
                { codigo },
                { projection: { evidencias: 1 } },
            );
            if (!incidencia) return res.status(404).json({ error: 'No se encontró el reporte.' });
            const data = storage
                ? await Promise.all(incidencia.evidencias.map(async (evidencia) => {
                    const signed = await storage!.storage.from(SUPABASE_BUCKET).createSignedUrl(evidencia.storage_path, 300);
                    if (signed.error) throw signed.error;
                    return { ...evidencia, url: signed.data.signedUrl };
                }))
                : (incidencia.evidencias ?? []);
            return res.json({ data });
        });

        // ── 2. POST /api/incidencias (Crear con Zod y Folio Atómico) ────────
        app.post('/api/incidencias', async (req: AuthenticatedRequest, res: express.Response) => {
            try {
                const datosValidados = incidenciaSchema.parse(req.body);

                const contadorRes = await db.collection<ContadorDocument>('contadores').findOneAndUpdate(
                    { _id: 'folio-2026' },
                    { $inc: { ultimo: 1 } },
                    { upsert: true, returnDocument: 'after' }
                );

                const numeroFolio = contadorRes?.ultimo ?? 1;
                const codigoFolio = `INC-2026-${String(numeroFolio).padStart(4, '0')}`;

                const nuevaIncidencia = {
                    codigo: codigoFolio,
                    ...datosValidados,
                    estado: 'abierta',
                    reportante: {
                        nombre: req.user!.nombre,
                        correo: req.user!.correo,
                        tipo: req.user!.rol === 'reportante' ? 'estudiante' : 'administrativo',
                    },
                    historial_seguimiento: [
                        {
                            fecha: new Date(),
                            autor: req.user!.nombre,
                            estado: 'abierta',
                            comentario: 'Incidencia registrada mediante API REST.'
                        }
                    ],
                    evidencias: [],
                    horas_invertidas: 0,
                    fecha_creacion: new Date()
                };

                await db.collection<IncidenciaDocument>('incidencias_campus').insertOne(nuevaIncidencia);

                return res.status(201).json({
                    message: "Incidencia registrada exitosamente",
                    codigo: codigoFolio,
                    data: nuevaIncidencia
                });

            } catch (error: unknown) {
                if (error instanceof z.ZodError) {
                    return res.status(400).json({
                        error: "Error de validación con Zod",
                        details: error.issues
                    });
                }
                console.error('Error al crear incidencia:', error);
                return res.status(500).json({ error: 'No se pudo crear el reporte.' });
            }
        });

        // ── 3. GET /api/incidencias (Consultar / Listar con filtros opcionales) ────────
        app.get('/api/incidencias', async (req: AuthenticatedRequest, res: express.Response) => {
            try {
                const { categoria, prioridad, estado } = req.query;
                const filtro: any = {};

                if (categoria) filtro.categoria = categoria;
                if (prioridad) filtro.prioridad = prioridad;
                if (estado) filtro.estado = estado;
                if (!esAdministrador(req.user!.rol)) {
                    const ocultos = await db.collection('moderacion_reportes')
                        .distinct('codigo', { estado: 'ocultar' });
                    if (ocultos.length) filtro.codigo = { $nin: ocultos };
                }

                const incidencias = await db.collection<IncidenciaDocument>('incidencias_campus')
                    .find(filtro, { projection: { 'reportante.correo': 0 } })
                    .toArray();

                return res.status(200).json({
                    total: incidencias.length,
                    data: incidencias
                });
            } catch (error: unknown) {
                console.error('Error al consultar incidencias:', error);
                return res.status(500).json({ error: 'No se pudieron consultar los reportes.' });
            }
        });

        app.patch('/api/incidencias/:codigo/responsable', requerirAdministrador, async (req, res) => {
            const codigo = routeParam(req.params.codigo);
            const parsed = asignacionUsuarioSchema.safeParse(req.body);
            if (!parsed.success || !ObjectId.isValid(parsed.data.usuarioId)) {
                return res.status(400).json({ error: 'El supervisor seleccionado no es válido.' });
            }
            const supervisor = await db.collection<UserDocument>('usuarios').findOne({
                _id: new ObjectId(parsed.data.usuarioId),
                activo: true,
                rol: { $in: ['administrador', 'superAdmin'] },
            });
            if (!supervisor) return res.status(400).json({ error: 'El responsable debe tener perfil administrador o superadministrador.' });
            const incidencia = await db.collection<IncidenciaDocument>('incidencias_campus').findOneAndUpdate(
                { codigo },
                { $set: { responsable_atencion: { nombre: supervisor.nombre, correo: supervisor.correo } } },
                { returnDocument: 'after' },
            );
            if (!incidencia) return res.status(404).json({ error: `No existe el reporte ${codigo}.` });
            return res.json({ data: incidencia });
        });

        app.patch('/api/incidencias/:codigo/tecnico', esTecnico, async (req: AuthenticatedRequest, res) => {
            const codigo = routeParam(req.params.codigo);
            const parsed = asignacionUsuarioSchema.safeParse(req.body);
            if (!parsed.success || !ObjectId.isValid(parsed.data.usuarioId)) {
                return res.status(400).json({ error: 'El técnico seleccionado no es válido.' });
            }
            const esSupervisor = esAdministrador(req.user!.rol);
            if (!esSupervisor && parsed.data.usuarioId !== req.user!.id) {
                return res.status(403).json({ error: 'Un técnico solo puede tomar una tarea para sí mismo.' });
            }
            const tecnico = await db.collection<UserDocument>('usuarios').findOne({
                _id: new ObjectId(parsed.data.usuarioId),
                activo: true,
                rol: 'tecnico',
            });
            if (!tecnico) return res.status(400).json({ error: 'La persona seleccionada debe tener perfil técnico.' });

            const filtro: Record<string, unknown> = {
                codigo,
                estado: { $nin: ['resuelta', 'cerrada'] },
            };
            if (!esSupervisor) {
                filtro.$or = [
                    { 'tecnico_asignado.correo': tecnico.correo },
                    { tecnico_asignado: { $exists: false } },
                    { tecnico_asignado: null },
                ];
            }
            const incidencia = await db.collection<IncidenciaDocument>('incidencias_campus').findOneAndUpdate(
                filtro,
                { $set: { tecnico_asignado: { nombre: tecnico.nombre, correo: tecnico.correo } } },
                { returnDocument: 'after' },
            );
            if (!incidencia) {
                const existe = await db.collection<IncidenciaDocument>('incidencias_campus').findOne({ codigo });
                if (!existe) return res.status(404).json({ error: `No existe el reporte ${codigo}.` });
                if (existe.estado === 'resuelta' || existe.estado === 'cerrada') {
                    return res.status(409).json({ error: 'No se puede asignar un reporte resuelto.' });
                }
                return res.status(409).json({ error: 'Este reporte ya fue tomado por otro técnico.' });
            }
            return res.json({ data: incidencia });
        });

        // ── 4. PATCH /api/incidencias/:codigo/estado (Actualizar estatus y bitácora) ────────
        app.patch('/api/incidencias/:codigo/estado', esTecnico, async (req: AuthenticatedRequest, res: express.Response) => {
            try {
                const codigo = routeParam(req.params.codigo);
                const { estado, comentario, horas_invertidas } = actualizarEstadoSchema.parse(req.body);
                const tecnicoAsignado = !esAdministrador(req.user!.rol);
                const incidenciaActual = await db.collection<IncidenciaDocument>('incidencias_campus').findOne(
                    { codigo },
                    { projection: { tecnico_asignado: 1 } },
                );
                if (!incidenciaActual) return res.status(404).json({ error: `Incidencia con código ${codigo} no encontrada` });
                if (tecnicoAsignado && incidenciaActual.tecnico_asignado &&
                    incidenciaActual.tecnico_asignado.correo !== req.user!.correo) {
                    return res.status(409).json({ error: 'Este reporte ya está asignado a otro técnico.' });
                }

                const seguimientoEntry: SeguimientoEntry = {
                    fecha: new Date(),
                    autor: req.user!.nombre,
                    estado,
                    comentario
                };

                const estaCerrada = estado === 'resuelta' || estado === 'cerrada';
                const actualizacion: Document[] = [
                    {
                        $set: {
                            estado,
                            horas_invertidas: {
                                $add: [{ $ifNull: ['$horas_invertidas', 0] }, horas_invertidas],
                            },
                            historial_seguimiento: {
                                $concatArrays: [
                                    { $ifNull: ['$historial_seguimiento', []] },
                                    [seguimientoEntry],
                                ],
                            },
                            ...(estado !== 'abierta' && tecnicoAsignado ? {
                                tecnico_asignado: {
                                    $ifNull: [
                                        '$tecnico_asignado',
                                        { $literal: { nombre: req.user!.nombre, correo: req.user!.correo } },
                                    ],
                                },
                            } : {}),
                            ...(estado !== 'abierta' && !tecnicoAsignado ? {
                                responsable_atencion: {
                                    $ifNull: [
                                        '$responsable_atencion',
                                        { $ifNull: [
                                            '$asignado_a',
                                            { $literal: { nombre: req.user!.nombre, correo: req.user!.correo } },
                                        ] },
                                    ],
                                },
                            } : {}),
                            ...(estaCerrada ? { fecha_cierre: { $literal: new Date() } } : {}),
                        },
                    },
                    ...(!estaCerrada ? [{ $unset: 'fecha_cierre' }] : []),
                ];

                const filtro: Record<string, unknown> = { codigo };
                if (tecnicoAsignado) {
                    filtro.$or = [
                        { 'tecnico_asignado.correo': req.user!.correo },
                        { tecnico_asignado: { $exists: false } },
                        { tecnico_asignado: null },
                    ];
                }
                const resultado = await db.collection<IncidenciaDocument>('incidencias_campus').findOneAndUpdate(
                    filtro,
                    actualizacion,
                    { returnDocument: 'after' }
                );

                const docActualizado = resultado;
                if (!docActualizado) {
                    if (tecnicoAsignado) return res.status(409).json({ error: 'Este reporte ya fue tomado por otro técnico.' });
                    return res.status(404).json({ error: `Incidencia con código ${codigo} no encontrada` });
                }

                return res.status(200).json({
                    message: "Estado de incidencia actualizado correctamente",
                    data: docActualizado
                });

            } catch (error: unknown) {
                if (error instanceof z.ZodError) {
                    return res.status(400).json({
                        error: "Error de validación con Zod",
                        details: error.issues
                    });
                }
                console.error('Error al actualizar incidencia:', error);
                return res.status(500).json({ error: 'No se pudo actualizar el reporte.' });
            }
        });

        const manejadorErrores: express.ErrorRequestHandler = (error, _req, res, next) => {
            if (res.headersSent) return next(error);
            const status = typeof error === 'object' && error !== null && 'status' in error &&
                typeof error.status === 'number' && error.status >= 400 && error.status < 600
                ? error.status
                : 500;
            console.error('Error no controlado en API:', error instanceof Error ? error.message : 'Error desconocido.');
            return res.status(status).json({
                error: status === 413 ? 'El archivo excede el límite de 10 MB.' : 'No se pudo completar la solicitud.',
            });
        };
        app.use(manejadorErrores);

        app.listen(PORT, () => {
            console.log(`Servidor corriendo en http://localhost:${PORT}`);
        });
    } catch (error) {
        console.error('Error al conectar con la base de datos:', error);
        if (client) {
            try {
                await client.close();
            } catch (closeError) {
                console.error('Error al cerrar la conexión con MongoDB:', closeError);
            }
        }
        process.exitCode = 1;
    }
}

startServer();