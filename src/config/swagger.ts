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
    }, '/api/v1/sessions/active': {
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
    
};
