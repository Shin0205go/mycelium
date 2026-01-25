#!/bin/bash
echo "Enter your Anthropic API key (input is hidden):"
read -s API_KEY
echo "ANTHROPIC_API_KEY=$API_KEY" > .env
echo "✅ .env created successfully!"
