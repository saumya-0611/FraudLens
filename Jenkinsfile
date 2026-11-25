// FraudLens Root Jenkinsfile (BhashaFlow-style Pre-Flight Docker Gatekeeper)
// Local dev uses:   ml-service=8000 (internal), backend=5000, frontend=5173
// Jenkins CI uses:  ml-service=9000,            backend=6000, frontend=6173 (via docker-compose.ci.yml)

pipeline {
    agent any

    environment {
        COMPOSE_PROJECT_NAME = "fraudlens-ci"
        COMPOSE_FILE         = "docker-compose.yml:docker-compose.ci.yml"
        COMPOSE_ENV_FILES    = ".env.ci"
        FRAUDLENS_ENV_FILE   = ".env.ci"
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
                    sh scripts/prepare_ci_env.sh
                    docker compose config --quiet
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
                    docker compose up --wait --wait-timeout 180
                    docker compose ps
                    docker compose exec -T backend wget -qO- http://localhost:5000/ready
                    docker compose exec -T ml-service curl -fsS http://localhost:8000/ready
                    echo "All FraudLens CI containers are up:"
                    echo "   ml-service -> http://localhost:9000/ready"
                    echo "   backend    -> http://localhost:6000/ready"
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
