package smartport_m1m.m1.controller;

import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import smartport_m1m.m1.service.VoyageHttpException;

@RestControllerAdvice(assignableTypes = {VoyageController.class, PartnerIntegrationController.class})
public class VoyageExceptionHandler {
    @ExceptionHandler(VoyageHttpException.class)
    public ResponseEntity<Map<String, Object>> handleNodeError(VoyageHttpException exception) {
        return ResponseEntity.status(exception.status()).body(exception.body());
    }
}
