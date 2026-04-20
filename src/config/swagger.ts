export const swaggerDocument = {
    openapi: '3.0.0',
    info: {
        title: 'NODi Server API',
        version: '1.0.0',
        description: 'Fleet Distraction Control Platform - API Documentation',
        contact: {
            name: 'NODi Support',
        },
    },
    servers: [
        {
            url: 'http://localhost:3000',
            description: 'Development server',
        },
    ],
    tags: [
        {
            name: 'Auth',
            description: 'Driver authentication endpoints',
        },
        {
            name: 'Companies',
            description: 'Company management endpoints',
        },
        {
            name: 'Drivers',
            description: 'Driver management endpoints',
        },
        {
            name: 'SSE',
            description: 'Server-Sent Events for real-time communication',
        },
        {
            name: 'Sessions',
            description: 'Driving session management',
        },
        {
            name: 'Fleet',
            description: 'Fleet manager auth (Firebase ID token)',
        },
    ],
    paths: {
        '/api/v1/auth/register': {
            post: {
                tags: ['Auth'],
                summary: 'Register a driver account',
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                required: ['name', 'email', 'password'],
                                properties: {
                                    name: {
                                        type: 'string',
                                        example: 'John Driver',
                                    },
                                    email: {
                                        type: 'string',
                                        example: 'driver@example.com',
                                    },
                                    password: {
                                        type: 'string',
                                        example: 'StrongPass123',
                                    },
                                },
                            },
                        },
                    },
                },
                responses: {
                    201: {
                        description: 'Driver account registered successfully',
                    },
                    409: {
                        description: 'Email already exists',
                    },
                    400: {
                        description: 'Validation error',
                    },
                },
            },
        },
        '/api/v1/auth/login': {
            post: {
                tags: ['Auth'],
                summary: 'Login driver account',
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                required: ['email', 'password'],
                                properties: {
                                    email: {
                                        type: 'string',
                                        example: 'driver@example.com',
                                    },
                                    password: {
                                        type: 'string',
                                        example: 'StrongPass123',
                                    },
                                },
                            },
                        },
                    },
                },
                responses: {
                    200: {
                        description: 'Login successful',
                    },
                    401: {
                        description: 'Invalid credentials',
                    },
                    400: {
                        description: 'Validation error',
                    },
                },
            },
        },
        '/api/v1/fleet/me': {
            get: {
                tags: ['Fleet'],
                summary: 'Current fleet manager (Firebase)',
                description:
                    'Send Authorization: Bearer with a Firebase Auth ID token. A row in fleet_managers must match firebase_uid. Response includes `companyName` and `contactNumber` for fleet profile / driver lock screen.',
                security: [{ bearerAuth: [] }],
                responses: {
                    200: {
                        description: 'Fleet manager profile and company assignments',
                    },
                    401: {
                        description: 'Missing, invalid, or expired Firebase token',
                    },
                    403: {
                        description: 'No fleet_managers row for this Firebase UID',
                    },
                    503: {
                        description: 'Firebase Admin not configured',
                    },
                },
            },
        },
        '/api/v1/fleet/me/profile': {
            patch: {
                tags: ['Fleet'],
                summary: 'Update fleet manager profile (name, company label, dispatch number)',
                description:
                    'Updates `fleet_managers.name`, `company_name`, and `contact_number`. Send at least one field; JSON `null` clears an optional string.',
                security: [{ bearerAuth: [] }],
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                properties: {
                                    name: { type: 'string', nullable: true },
                                    companyName: { type: 'string', nullable: true },
                                    contactNumber: { type: 'string', nullable: true },
                                },
                            },
                        },
                    },
                },
                responses: {
                    200: { description: 'Same shape as GET /fleet/me' },
                    400: { description: 'Validation error' },
                    401: { description: 'Invalid or missing Firebase token' },
                    403: { description: 'Not an active fleet manager' },
                    503: { description: 'Firebase Admin not configured' },
                },
            },
        },
        '/api/v1/fleet/live-locations': {
            get: {
                tags: ['Fleet'],
                summary: 'Live driver locations (Motive)',
                description:
                    'Fleet managers only. Firebase Bearer. Enriches from available_time (duty + vehicle id for speed) and vehicle_locations for speedMph. Each item includes speedMph (number or null) when speed enrichment is on; null means Motive did not report a numeric speed for that driver/vehicle. lean=1 = driver_locations only.',
                security: [{ bearerAuth: [] }],
                parameters: [
                    {
                        name: 'lean',
                        in: 'query',
                        schema: { type: 'string', enum: ['0', '1', 'true', 'false'] },
                        description: 'If 1/true: skip duty and speed Motive calls (map-only, faster).',
                    },
                    {
                        name: 'duty',
                        in: 'query',
                        schema: { type: 'string', enum: ['0', '1', 'true', 'false'] },
                        description: 'If 0/false: omit available_time / dutyStatus.',
                    },
                    {
                        name: 'speed',
                        in: 'query',
                        schema: { type: 'string', enum: ['0', '1', 'true', 'false'] },
                        description:
                            'If 0/false: skip vehicle_locations calls; speedMph is omitted from items.',
                    },
                ],
                responses: {
                    200: {
                        description: 'List of live driver location points',
                    },
                    401: {
                        description: 'Invalid or missing Firebase token',
                    },
                    403: {
                        description: 'User is not an active fleet manager',
                    },
                    502: {
                        description: 'Motive API error',
                    },
                    503: {
                        description: 'Motive API key not configured',
                    },
                },
            },
        },
        '/api/v1/fleet/dashboard': {
            get: {
                tags: ['Fleet'],
                summary: 'Fleet dashboard snapshot',
                description:
                    'Firebase Bearer (fleet manager). Returns `stats` (active driver count as `activeVehicles`, open sessions with blocking requested+applied as `currentlyLocked`, `tamperAlertsToday` = count of sessions with `is_tampered` and `tampered_at` on the current US Eastern calendar day), `safety.score` as the fleet average of per-session scores (100 − 2×`total_block_attempts`, min 50) over `driving_sessions` in the last-30-day window (started or ended in the window, or still open; 100 if none), and `activity` as a merged feed of recent tamper events (`tampered_at`, `tampered_reason`) and recent unlock-attempt sessions (`total_block_attempts` > 0), newest first.',
                security: [{ bearerAuth: [] }],
                responses: {
                    200: {
                        description: '{ success, data: { stats, safety, activity } }',
                    },
                    401: {
                        description: 'Invalid or missing Firebase token',
                    },
                    403: {
                        description: 'User is not an active fleet manager',
                    },
                },
            },
        },
        '/api/v1/fleet/violations': {
            get: {
                tags: ['Fleet'],
                summary: 'Fleet violations (driving sessions with block attempts)',
                description:
                    'Firebase Bearer (fleet manager). Returns `driving_sessions` where `total_block_attempts` > 0 or tampered, with driver name, `started_at`/`ended_at` as ISO UTC, `tampered_at` as `tamperedAtUtc` when set, `blockedAttemptAtUtc` from `blocked_attempt_timestamps`, `vehicle_number` as Motive `vehicle.number` when available from live driver-locations, otherwise from `GET /v1/vehicle_locations/:vehicleId` using the session `vehicle_id`, and blocking snapshot fields. Not filtered by company.',
                security: [{ bearerAuth: [] }],
                responses: {
                    200: {
                        description: '{ success, data: { violations: [...] } }',
                    },
                    401: {
                        description: 'Invalid or missing Firebase token',
                    },
                    403: {
                        description: 'User is not an active fleet manager',
                    },
                },
            },
        },
        '/api/v1/fleet/drivers': {
            get: {
                tags: ['Fleet'],
                summary: 'Fleet driver roster',
                description:
                    'Firebase Bearer (fleet manager). Returns all active `drivers` rows (`name` from DB); each row includes `truckId` as Motive `vehicle.number` when present on live driver-locations for that Motive driver id, otherwise resolved from `GET /v1/vehicle_locations/:vehicleId` for the active or latest-session vehicle id, otherwise the raw Motive vehicle id string. Also `safetyScore` (average per-session score over `driving_sessions` in the rolling 30-day window: 100 − 2×`total_block_attempts` per session, min 50), `totalBlockAttempts` (sum of attempts across those windowed sessions), and `dutyStatus` (webhook fallback). Fleet UI merges `dutyStatus` from Motive live-locations when that snapshot includes the driver. Not filtered by company.',
                security: [{ bearerAuth: [] }],
                responses: {
                    200: {
                        description: '{ success, data: { drivers: [...] } }',
                    },
                    401: {
                        description: 'Invalid or missing Firebase token',
                    },
                    403: {
                        description: 'User is not an active fleet manager',
                    },
                },
            },
        },
        '/api/v1/fleet/drivers/{driverId}': {
            get: {
                tags: ['Fleet'],
                summary: 'Fleet driver detail (session + distraction timeline)',
                description:
                    'Firebase Bearer (fleet manager). Returns `drivers` plus active/latest `driving_sessions` (any company), push-command spikes, `safetyScore` (same 30-day average as the drivers list, then minus 5 points per session with `is_tampered` in that window, floored at 50), `totalBlockAttempts` (same window as list), `sessionTimelines`: recent sessions (newest first, up to 35), and `truckId` as Motive `vehicle.number` for the active session vehicle when resolvable from Motive APIs (else numeric vehicle id). Path id is internal `drivers.id` or `motive_driver_id`. Not filtered by company.',
                security: [{ bearerAuth: [] }],
                parameters: [
                    {
                        name: 'driverId',
                        in: 'path',
                        required: true,
                        schema: { type: 'integer', minimum: 1 },
                        description:
                            'Internal `drivers.id` or Motive `drivers.motive_driver_id` (UI often uses the latter from live-locations).',
                    },
                ],
                responses: {
                    200: {
                        description: 'Driver detail payload',
                    },
                    400: {
                        description: 'Invalid driver id',
                    },
                    401: {
                        description: 'Invalid or missing Firebase token',
                    },
                    403: {
                        description: 'User is not an active fleet manager',
                    },
                    404: {
                        description: 'Driver not found',
                    },
                },
            },
        },
        '/api/v1/companies': {
            post: {
                tags: ['Companies'],
                summary: 'Create a new company',
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                required: ['name'],
                                properties: {
                                    name: {
                                        type: 'string',
                                        example: 'ABC Logistics',
                                    },
                                    motiveCompanyId: {
                                        type: 'integer',
                                        example: 12345,
                                    },
                                },
                            },
                        },
                    },
                },
                responses: {
                    201: {
                        description: 'Company created successfully',
                    },
                    400: {
                        description: 'Validation error',
                    },
                },
            },
            get: {
                tags: ['Companies'],
                summary: 'List all companies',
                responses: {
                    200: {
                        description: 'List of companies',
                    },
                },
            },
        },
        '/api/v1/companies/{id}': {
            get: {
                tags: ['Companies'],
                summary: 'Get company by ID',
                parameters: [
                    {
                        name: 'id',
                        in: 'path',
                        required: true,
                        schema: {
                            type: 'integer',
                        },
                    },
                ],
                responses: {
                    200: {
                        description: 'Company details',
                    },
                    404: {
                        description: 'Company not found',
                    },
                },
            },
        },
        '/api/v1/drivers/register': {
            post: {
                tags: ['Drivers'],
                summary: 'Register a driver (phone-based)',
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                required: ['phone'],
                                properties: {
                                    phone: {
                                        type: 'string',
                                        example: '+1234567890',
                                    },
                                    name: {
                                        type: 'string',
                                        example: 'John Doe',
                                    },
                                    email: {
                                        type: 'string',
                                        example: 'john@example.com',
                                    },
                                    deviceId: {
                                        type: 'string',
                                        example: 'ABC123-DEF456',
                                    },
                                    devicePlatform: {
                                        type: 'string',
                                        enum: ['ios', 'android'],
                                        example: 'ios',
                                    },
                                    fcmToken: {
                                        type: 'string',
                                        example: 'fcm_token_here',
                                    },
                                },
                            },
                        },
                    },
                },
                responses: {
                    201: {
                        description: 'Driver registered successfully',
                    },
                    200: {
                        description: 'Driver already exists, device updated',
                    },
                    400: {
                        description: 'Validation error',
                    },
                },
            },
        },
        '/api/v1/drivers/{id}/assign': {
            post: {
                tags: ['Drivers'],
                summary: 'Assign driver to company',
                parameters: [
                    {
                        name: 'id',
                        in: 'path',
                        required: true,
                        schema: {
                            type: 'integer',
                        },
                    },
                ],
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                required: ['companyId', 'role'],
                                properties: {
                                    companyId: {
                                        type: 'integer',
                                        example: 1,
                                    },
                                    role: {
                                        type: 'string',
                                        enum: ['driver', 'co_passenger', 'cleaner'],
                                        example: 'driver',
                                    },
                                    motiveDriverId: {
                                        type: 'integer',
                                        example: 999,
                                    },
                                },
                            },
                        },
                    },
                },
                responses: {
                    201: {
                        description: 'Driver assigned successfully',
                    },
                    404: {
                        description: 'Driver or company not found',
                    },
                    400: {
                        description: 'Driver already assigned to this company',
                    },
                },
            },
        },
        '/api/v1/drivers': {
            get: {
                tags: ['Drivers'],
                summary: 'List all drivers',
                responses: {
                    200: {
                        description: 'List of drivers',
                    },
                },
            },
        },
        '/api/v1/drivers/{id}': {
            get: {
                tags: ['Drivers'],
                summary: 'Get driver by ID',
                parameters: [
                    {
                        name: 'id',
                        in: 'path',
                        required: true,
                        schema: {
                            type: 'integer',
                        },
                    },
                ],
                responses: {
                    200: {
                        description: 'Driver details',
                    },
                    404: {
                        description: 'Driver not found',
                    },
                },
            },
        },
        '/api/v1/webhooks/motive': {
        post: {
            tags: ['Webhooks'],
            summary: 'Receive Motive duty status webhook',
            description: 'Endpoint for Motive to send driver duty status updates',
            parameters: [
                {
                    name: 'X-Motive-Signature',
                    in: 'header',
                    required: true,
                    schema: {
                        type: 'string',
                    },
                    description: 'HMAC signature for webhook verification',
                },
            ],
            requestBody: {
                required: true,
                content: {
                    'application/json': {
                        schema: {
                            type: 'object',
                            required: ['action', 'id', 'duty_status'],
                            properties: {
                                action: {
                                    type: 'string',
                                    example: 'user_duty_status_updated',
                                },
                                trigger: {
                                    type: 'string',
                                    example: 'updated',
                                },
                                id: {
                                    type: 'integer',
                                    description: 'Motive driver ID',
                                    example: 123456,
                                },
                                role: {
                                    type: 'string',
                                    example: 'driver',
                                },
                                username: {
                                    type: 'string',
                                    example: 'test-driver-name',
                                },
                                first_name: {
                                    type: 'string',
                                    example: 'Test',
                                },
                                last_name: {
                                    type: 'string',
                                    example: 'Driver-name',
                                },
                                email: {
                                    type: 'string',
                                    nullable: true,
                                    example: null,
                                },
                                phone: {
                                    type: 'string',
                                    nullable: true,
                                    example: null,
                                },
                                driver_company_id: {
                                    type: 'integer',
                                    nullable: true,
                                    description: 'Motive company ID',
                                    example: null,
                                },
                                duty_status: {
                                    type: 'string',
                                    enum: ['off_duty', 'on_duty', 'driving', 'sleeper_berth'],
                                    example: 'on_duty',
                                },
                                status: {
                                    type: 'string',
                                    example: 'active',
                                },
                                updated_at: {
                                    type: 'string',
                                    format: 'date-time',
                                    example: '2025-02-19T11:04:09Z',
                                },
                            },
                        },
                    },
                },
            },
            responses: {
                200: {
                    description: 'Webhook processed successfully',
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                properties: {
                                    success: {
                                        type: 'boolean',
                                        example: true,
                                    },
                                    data: {
                                        type: 'object',
                                        properties: {
                                            webhookId: {
                                                type: 'string',
                                                example: '1',
                                            },
                                            sessionId: {
                                                type: 'integer',
                                                nullable: true,
                                                example: null,
                                            },
                                        },
                                    },
                                    message: {
                                        type: 'string',
                                        example: 'Duty status on_duty logged for driver Test Driver-name',
                                    },
                                },
                            },
                        },
                    },
                },
                400: {
                    description: 'Invalid webhook payload or processing failed',
                },
                401: {
                    description: 'Invalid HMAC signature',
                },
            },
        },
    },
    '/api/v1/sse/stream': {
        get: {
            tags: ['SSE'],
            summary: 'Establish SSE connection for real-time updates',
            description: 'Mobile app connects here to receive real-time blocking triggers',
            parameters: [
                {
                    name: 'driver_id',
                    in: 'query',
                    required: true,
                    schema: {
                        type: 'integer',
                    },
                    description: 'Driver ID to connect',
                    example: 1,
                },
            ],
            responses: {
                200: {
                    description: 'SSE stream established',
                    content: {
                        'text/event-stream': {
                            schema: {
                                type: 'string',
                                example: 'event: connected\ndata: {"driverId":1,"serverTime":"2024-..."}\n\n',
                            },
                        },
                    },
                },
                400: {
                    description: 'Invalid driver_id',
                },
            },
        },
    },
    '/api/v1/sse/stats': {
        get: {
            tags: ['SSE'],
            summary: 'Get SSE connection statistics',
            responses: {
                200: {
                    description: 'Connection stats',
                },
            },
        },
    },
    '/api/v1/sessions/active': {
        get: {
            tags: ['Sessions'],
            summary: 'Get all active sessions',
            responses: {
                200: {
                    description: 'List of active driving sessions',
                },
            },
        },
    },
    '/api/v1/sessions/{id}': {
        get: {
            tags: ['Sessions'],
            summary: 'Get session by ID',
            parameters: [
                {
                    name: 'id',
                    in: 'path',
                    required: true,
                    schema: {
                        type: 'integer',
                    },
                },
            ],
            responses: {
                200: {
                    description: 'Session details',
                },
                404: {
                    description: 'Session not found',
                },
            },
        },
    },
    '/api/v1/sessions/{id}/end': {
        post: {
            tags: ['Sessions'],
            summary: 'End a session (admin override)',
            parameters: [
                {
                    name: 'id',
                    in: 'path',
                    required: true,
                    schema: {
                        type: 'integer',
                    },
                },
            ],
            requestBody: {
                content: {
                    'application/json': {
                        schema: {
                            type: 'object',
                            properties: {
                                reason: {
                                    type: 'string',
                                    example: 'admin_override',
                                },
                            },
                        },
                    },
                },
            },
            responses: {
                200: {
                    description: 'Session ended successfully',
                },
            },
        },
    },
    '/api/v1/sessions/driver/{driverId}': {
        get: {
            tags: ['Sessions'],
            summary: 'Get sessions for a driver',
            parameters: [
                {
                    name: 'driverId',
                    in: 'path',
                    required: true,
                    schema: {
                        type: 'integer',
                    },
                },
                {
                    name: 'limit',
                    in: 'query',
                    schema: {
                        type: 'integer',
                        default: 50,
                    },
                },
            ],
            responses: {
                200: {
                    description: 'List of driver sessions',
                },
            },
        },
    },
    },
    components: {
        securitySchemes: {
            bearerAuth: {
                type: 'http',
                scheme: 'bearer',
                bearerFormat: 'JWT',
                description: 'Firebase Auth ID token',
            },
        },
    },
};
