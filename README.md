
#### Start Web Server
Use Docker to build a demo web app using the parser for its backend: 
```
(cd pdf-parser && docker build --tag=pdfparser .)
docker run -p 4775:4775 pdfparser 

```
Then navigate to http://localhost:4775 to access the app.





