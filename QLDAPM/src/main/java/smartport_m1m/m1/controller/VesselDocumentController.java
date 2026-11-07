package smartport_m1m.m1.controller;

import java.util.Map;

import jakarta.validation.Valid;

import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import smartport_m1m.m1.dto.ReviewVesselDocumentRequest;
import smartport_m1m.m1.service.VesselDocumentService;

@RestController
@RequestMapping("/api/v1/vessels/{shipId}/documents")
public class VesselDocumentController {

    private final VesselDocumentService documentService;

    public VesselDocumentController(VesselDocumentService documentService) {
        this.documentService = documentService;
    }

    @PostMapping(consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<Map<String, Object>> upload(
            @PathVariable long shipId,
            @RequestParam("document_type") String documentType,
            @RequestPart("file") MultipartFile file) {
        return ResponseEntity.status(201)
                .body(documentService.upload(shipId, documentType, file));
    }

    @GetMapping
    public ResponseEntity<Map<String, Object>> list(@PathVariable long shipId) {
        return ResponseEntity.ok(documentService.list(shipId));
    }

    @GetMapping("/{documentId}")
    public ResponseEntity<Map<String, Object>> metadata(
            @PathVariable long shipId, @PathVariable long documentId) {
        return ResponseEntity.ok(documentService.metadata(shipId, documentId));
    }

    @GetMapping("/{documentId}/download")
    public ResponseEntity<byte[]> download(
            @PathVariable long shipId, @PathVariable long documentId) {
        ResponseEntity<byte[]> upstream = documentService.download(shipId, documentId);
        HttpHeaders headers = new HttpHeaders();
        MediaType contentType = upstream.getHeaders().getContentType();
        headers.setContentType(contentType == null
                ? MediaType.APPLICATION_OCTET_STREAM : contentType);
        if (upstream.getHeaders().getContentDisposition().isAttachment()) {
            headers.setContentDisposition(upstream.getHeaders().getContentDisposition());
        }
        if (upstream.getBody() != null) {
            headers.setContentLength(upstream.getBody().length);
        }
        return ResponseEntity.status(upstream.getStatusCode())
                .headers(headers)
                .body(upstream.getBody());
    }

    // DEMO ONLY: authentication and reviewer authorization are not implemented.
    @PatchMapping("/{documentId}/review")
    public ResponseEntity<Map<String, Object>> review(
            @PathVariable long shipId,
            @PathVariable long documentId,
            @Valid @org.springframework.web.bind.annotation.RequestBody
                    ReviewVesselDocumentRequest request) {
        return ResponseEntity.ok(documentService.review(shipId, documentId, request));
    }
}
