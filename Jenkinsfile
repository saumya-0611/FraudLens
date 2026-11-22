// FraudLens Root Jenkinsfile (BhashaFlow-style Pre-Flight Docker Gatekeeper)
// Local dev uses:   ml-service=8000 (internal), backend=5000, frontend=5173
// Jenkins CI uses:  ml-service=9000,            backend=6000, frontend=6173 (via docker-compose.ci.yml)

pipeline {
    agent any

    environment {
        COMPOSE_PROJECT_NAME = "fraudlens-ci"
        COMPOSE_FILE         = "docker-compose.yml:docker-compose.ci.yml"
    }

    stages {
        stage('Checkout') {
            steps {
                checkout scm
            }
        }

        stage('Cleanup Previous CI Run') {
            steps {
                // Only stops fraudlens-ci containers — never touches your local dev stack
                sh 'docker compose down --remove-orphans --volumes || docker-compose down --remove-orphans --volumes || true'
            }
        }

        stage('Prepare Environment') {
            steps {
                sh '''
                    cp .env.example .env
                    echo "FRONTEND_HOST_PORT=6173" >> .env
                    echo "BACKEND_HOST_PORT=6000"  >> .env
                '''
            }
        }

        stage('Build Docker Images') {
            steps {
                sh 'docker compose build || docker-compose build'
            }
        }

        stage('Test & Run Pre-Flight Stack') {
            steps {
                sh '''
                    docker compose up -d postgres kafka kafka-init ml-service backend streaming frontend || docker-compose up -d
                    sleep 15
                    docker compose ps || docker-compose ps
                    RUNNING=$( (docker compose ps --services --filter "status=running" 2>/dev/null || docker-compose ps --services --filter "status=running") | wc -l )
                    if [ "$RUNNING" -lt 4 ]; then
                        echo "Not all core containers are running"
                        docker compose logs || docker-compose logs
                        exit 1
                    fi
                    echo "All FraudLens CI containers are up:"
                    echo "   ml-service -> http://localhost:9000/health"
                    echo "   backend    -> http://localhost:6000/health"
                    echo "   frontend   -> http://localhost:6173"
                '''
            }
        }
    }

    post {
        always {
            // Clean up CI containers after every run
            sh 'docker compose down --remove-orphans --volumes || docker-compose down --remove-orphans --volumes || true'
        }
        success {
            echo 'FraudLens Pre-Flight Build Passed!'
        }
    }
}
