
package smartport_m1m.m1.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.server.ResponseStatusException;

import smartport_m1m.m1.dto.CreateVesselRequest;
import smartport_m1m.service.ShipApiService;

class VesselServiceTest {

    private final ShipApiService shipApiService =
            mock(ShipApiService.class);

    private final VesselService vesselService =
            new VesselService(shipApiService);

    private CreateVesselRequest validRequest() {
        return new CreateVesselRequest(
                "TAU05",
                "Tau thu nghiem",
                "9074729",
                "CONTAINER",
                new BigDecimal("10000"),
                new BigDecimal("180"),
                new BigDecimal("9.5")
        );
    }

    @Test
    void duplicateShipCodeShouldReturn409() {

        when(shipApiService.getAllShips()).thenReturn(
                Map.of(
                        "success", true,
                        "data", List.of(
                                Map.of("ship_code", "TAU05")
                        )
                )
        );

        ResponseStatusException exception = assertThrows(
                ResponseStatusException.class,
                () -> vesselService.createVessel(validRequest())
        );

        assertEquals(HttpStatus.CONFLICT,
                exception.getStatusCode());

        verify(shipApiService, never())
                .createShip(any());
    }

    @Test
    void validVesselShouldBeCreated() {

        CreateVesselRequest request = validRequest();

        when(shipApiService.getAllShips()).thenReturn(
                Map.of(
                        "success", true,
                        "data", List.of()
                )
        );

        when(shipApiService.createShip(request)).thenReturn(
                Map.of(
                        "success", true,
                        "id", 5
                )
        );

        Map<String, Object> response =
                vesselService.createVessel(request);

        assertEquals(true, response.get("success"));
        assertEquals(5, response.get("id"));
    }

    @Test
    void duplicateImoFromNodeShouldReturn409() {

        CreateVesselRequest request = validRequest();

        when(shipApiService.getAllShips()).thenReturn(
                Map.of(
                        "success", true,
                        "data", List.of()
                )
        );

        when(shipApiService.createShip(request)).thenThrow(
                new HttpClientErrorException(HttpStatus.CONFLICT)
        );

        ResponseStatusException exception = assertThrows(
                ResponseStatusException.class,
                () -> vesselService.createVessel(request)
        );

        assertEquals(HttpStatus.CONFLICT,
                exception.getStatusCode());
    }

    @Test
    void deactivateVesselShouldReturnNodeResponse() {
        Map<String, Object> response = Map.of(
                "success", true, "shipId", 7);
        when(shipApiService.deactivateShip(7, "Retired"))
                .thenReturn(response);

        assertSame(response,
                vesselService.deactivateVessel(7, " Retired "));
        verify(shipApiService).deactivateShip(7, "Retired");
    }

    @Test
    void deactivateVesselShouldMapNodeClientErrors() {
        for (HttpStatus status : List.of(
                HttpStatus.BAD_REQUEST,
                HttpStatus.NOT_FOUND,
                HttpStatus.CONFLICT)) {
            doThrow(new HttpClientErrorException(status))
                    .when(shipApiService).deactivateShip(7, "Retired");

            ResponseStatusException exception = assertThrows(
                    ResponseStatusException.class,
                    () -> vesselService.deactivateVessel(7, "Retired"));
            assertEquals(status, exception.getStatusCode());
        }
    }

    @Test
    void deactivateVesselShouldMapConnectionFailure() {
        when(shipApiService.deactivateShip(7, "Retired"))
                .thenThrow(new org.springframework.web.client.ResourceAccessException(
                        "connection refused"));

        ResponseStatusException exception = assertThrows(
                ResponseStatusException.class,
                () -> vesselService.deactivateVessel(7, "Retired"));
        assertEquals(HttpStatus.BAD_GATEWAY, exception.getStatusCode());
    }

    @Test
    void deactivateVesselShouldRejectMalformedNodeResponse() {
        when(shipApiService.deactivateShip(7, "Retired"))
                .thenReturn(Map.of("success", false));

        ResponseStatusException exception = assertThrows(
                ResponseStatusException.class,
                () -> vesselService.deactivateVessel(7, "Retired"));
        assertEquals(HttpStatus.BAD_GATEWAY, exception.getStatusCode());
    }

    @Test
    void deactivateVesselShouldValidateIdAndReasonBeforeCallingNode() {
        for (var args : List.of(
                new Object[]{0L, "Retired"},
                new Object[]{7L, " "},
                new Object[]{7L, "x".repeat(501)})) {
            ResponseStatusException exception = assertThrows(
                    ResponseStatusException.class,
                    () -> vesselService.deactivateVessel(
                            (long) args[0], (String) args[1]));
            assertEquals(HttpStatus.BAD_REQUEST, exception.getStatusCode());
        }
        verify(shipApiService, never()).deactivateShip(anyLong(), anyString());
    }
}
